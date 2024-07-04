/* eslint no-unused-vars: 0 */

function xlsxColAutofit (options) {
  if (
    options?.data?.meta?.autofit?.enabledFor?.length > 0 &&
    options.hash.all === true
  ) {
    options.data.meta.autofit.enabledFor = [true]
  }

  return ''
}

function xlsxChart (options) {
  const Handlebars = require('handlebars')

  if (options.hash.data == null) {
    throw new Error('xlsxChart helper requires data parameter to be set')
  }

  if (!Array.isArray(options.hash.data.labels) || options.hash.data.labels.length === 0) {
    throw new Error('xlsxChart helper requires data parameter with labels to be set, data.labels must be an array with items')
  }

  if (!Array.isArray(options.hash.data.datasets) || options.hash.data.datasets.length === 0) {
    throw new Error('xlsxChart helper requires data parameter with datasets to be set, data.datasets must be an array with items')
  }

  if (
    options.hash.options != null &&
      (
        typeof options.hash.options !== 'object' ||
        Array.isArray(options.hash.options)
      )
  ) {
    throw new Error('xlsxChart helper when options parameter is set, it should be an object')
  }

  return new Handlebars.SafeString(`$xlsxChart${Buffer.from(JSON.stringify(options.hash)).toString('base64')}$`)
}

function xlsxContext (options) {
  const Handlebars = require('handlebars')
  let data

  if (options.hash.type === 'global') {
    data = Handlebars.createFrame(options.data)
    data.evalId = options.hash.evalId
    data.calcChainUpdatesMap = new Map()
  }

  const context = {}

  if (data) {
    context.data = data
  }

  const result = options.fn(this, context)

  return result
}

const __xlsxD = (function () {
  function ws (options) {
    const Handlebars = require('handlebars')
    const newData = Handlebars.createFrame(options.data)
    const sheetId = options.hash.sheetId

    assertOk(sheetId != null, 'sheetId arg is required')

    newData.sheetId = sheetId

    const tasks = new Map()

    newData.tasks = {
      wait (key) {
        return tasks.get(key)?.promise
      },
      add (key) {
        let taskExecution = tasks.get(key)

        if (taskExecution != null) {
          return taskExecution.resolve
        }

        taskExecution = {}

        taskExecution.promise = new Promise((resolve) => {
          taskExecution.resolve = resolve
        })

        tasks.set(key, taskExecution)

        return taskExecution.resolve
      }
    }

    // init tasks
    newData.tasks.add('sd')

    newData.meta = {
      calcChainCellRefsSet: null,
      autofit: {
        cols: {},
        enabledFor: null
      },
      mergeCells: [],
      trackedCells: null,
      updatedOriginalCells: {},
      lazyFormulas: {},
      lastCellRef: null
    }

    newData.loopItems = []
    newData.evaluatedLoopsIds = []
    newData.outOfLoopTemplates = Object.create(null)

    return options.fn(this, { data: newData })
  }

  function sd (options) {
    const resolveTask = options.data.tasks.add('sd')

    try {
      const Handlebars = require('handlebars')

      options.data.meta.calcChainCellRefsSet = new Set(options.hash.calcChainCellRefs != null ? options.hash.calcChainCellRefs.split(',') : [])

      let nonExistingCellRefs = options.hash.nonExistingCellRefs != null ? options.hash.nonExistingCellRefs.split(',') : []
      const autofit = options.hash.autofit != null ? options.hash.autofit.split(',') : []
      const trackedCells = {}

      if (nonExistingCellRefs.length > 0) {
        nonExistingCellRefs = nonExistingCellRefs.map((cellRef) => {
          const parts = cellRef.split('|')
          const result = {
            ref: parts[0]
          }

          if (parts.length === 2) {
            result.inLoop = true
            result.loopHierarchyId = parts[1]
          }

          return result
        })

        for (const cellRefEntry of nonExistingCellRefs) {
          trackedCells[cellRefEntry.ref] = {
            first: cellRefEntry.ref,
            last: cellRefEntry.ref,
            count: 0
          }

          if (cellRefEntry.inLoop) {
            trackedCells[cellRefEntry.ref].inLoop = cellRefEntry.inLoop
            trackedCells[cellRefEntry.ref].loopHierarchyId = cellRefEntry.loopHierarchyId
          } else {
            trackedCells[cellRefEntry.ref].inLoop = false
          }
        }
      }

      options.data.meta.autofit.enabledFor = autofit
      options.data.meta.trackedCells = trackedCells

      return options.fn(this, { data: options.data })
    } finally {
      resolveTask()
    }
  }

  // this helper is async on purpose so it can wait for the sd helper to finish.
  // this is needed because the dimension tag appears before the sheetData tag and
  // we want to keep to logic for updating this node in handlebars
  async function dimension (options) {
    const originalCellRefRange = options.hash.o

    assertOk(originalCellRefRange != null, 'originalCellRefRange arg is required')

    await options.data.tasks.wait('sd')

    const refsParts = originalCellRefRange.split(':')

    if (refsParts.length === 1) {
      return refsParts[0]
    }

    const { parseCellRef } = require('cellUtils')
    const lastCellRef = options.data.meta.lastCellRef
    const parsedEndCellRef = parseCellRef(refsParts[1])
    const parsedLastCellRef = parseCellRef(lastCellRef)
    return `${refsParts[0]}:${parsedEndCellRef.letter}${parsedLastCellRef.rowNumber}`
  }

  function loop (data, options) {
    const Handlebars = require('handlebars')
    const start = options.hash.start
    const columnStart = options.hash.columnStart
    const end = options.hash.end
    const columnEnd = options.hash.columnEnd
    const hierarchyId = options.hash.hierarchyId
    const newData = Handlebars.createFrame(options.data)

    assertOk(start != null, 'start arg is required')
    assertOk(columnStart != null, 'columnStart arg is required')
    assertOk(columnEnd != null, 'columnEnd arg is required')
    assertOk(hierarchyId != null, 'hierarchyId arg is required')

    let targetData = data

    // for empty we create an array with one empty object,
    // this is needed because we want to preserve the original row
    if (
      targetData == null ||
      (Array.isArray(targetData) && targetData.length === 0)
    ) {
      targetData = [{}]
    }

    const loopItem = {
      type: end == null ? 'row' : 'block',
      id: null,
      hierarchyId,
      start,
      columnStart,
      end,
      columnEnd,
      length: targetData.length,
      parentLoopIndex: options.data.index,
      children: [],
      completed: false
    }

    const parentLoopItem = getParentLoopItemByHierarchy(loopItem, newData.loopItems)

    let container

    if (parentLoopItem) {
      container = parentLoopItem.children
    } else {
      container = newData.loopItems
    }

    loopItem.id = `${parentLoopItem != null ? `${parentLoopItem.id}#` : ''}${container.length}`

    container.push(loopItem)

    newData.currentLoopId = loopItem.id
    newData.evaluatedLoopsIds.push(loopItem.id)

    const result = Handlebars.helpers.each(targetData, { ...options, data: newData })

    loopItem.completed = true

    return result
  }

  function outOfLoop (options) {
    const Handlebars = require('handlebars')
    const item = options.hash.item

    assertOk(item != null, 'item arg is required')

    options.data.outOfLoopTemplates[item] = (currentLoopId, currentIdx) => {
      const newData = Handlebars.createFrame(options.data)

      newData.currentLoopId = currentLoopId

      if (currentIdx != null) {
        newData.index = currentIdx
      }

      return options.fn(this, { data: newData })
    }

    return new Handlebars.SafeString('')
  }

  function outOfLoopPlaceholder (options) {
    const Handlebars = require('handlebars')
    const item = options.hash.item

    assertOk(item != null, 'item arg is required')

    const outOfLoopTemplate = options.data.outOfLoopTemplates[item]

    assertOk(outOfLoopTemplate != null, 'outOfLoopItem was not found')

    const currentLoopId = options.data.currentLoopId

    assertOk(currentLoopId != null, 'currentLoopId not found')

    const currentIdx = options.data.index

    const output = outOfLoopTemplate(currentLoopId, currentIdx)

    return new Handlebars.SafeString(output)
  }

  function r (options) {
    const Handlebars = require('handlebars')
    const originalRowNumber = options.hash.o

    assertOk(originalRowNumber != null, 'originalRowNumber arg is required')

    const newData = Handlebars.createFrame(options.data)

    const currentLoopItem = getCurrentLoopItem(newData.currentLoopId, newData.loopItems)
    // this gets the previous loops (loops defined before a cell) and also on the case of nested loops
    // all the previous executions of the current loop
    const previousLoopItems = getPreviousLoopItems(newData.currentLoopId, newData.evaluatedLoopsIds, newData.loopItems)

    const previousMeta = {
      prev: {
        total: 0,
        rowLoopLength: 0
      },
      rest: {
        total: 0,
        rowLoopLength: 0
      }
    }

    const currentRootLoopIdNum = newData.currentLoopId != null ? parseInt(newData.currentLoopId.split('#')[0], 10) : -1

    let currentLoopIncrement = 0

    for (const item of previousLoopItems) {
      const previousRootLoopIdNum = parseInt(item.id.split('#')[0], 10)
      const isPrev = currentRootLoopIdNum === -1 ? true : previousRootLoopIdNum < currentRootLoopIdNum
      let loopItemsLength = 0
      const target = isPrev ? previousMeta.prev : previousMeta.rest

      if (item.type === 'block') {
        loopItemsLength += getLoopItemTemplateLength(item) * (item.length - 1)
      } else {
        loopItemsLength += item.length
        target.rowLoopLength += 1
      }

      target.total += loopItemsLength
    }

    const previousRootLoopIncrement = previousMeta.prev.total + (previousMeta.prev.rowLoopLength > 0 ? previousMeta.prev.rowLoopLength * -1 : 0)
    const previousLoopIncrement = previousRootLoopIncrement + previousMeta.rest.total + (previousMeta.rest.rowLoopLength > 0 ? previousMeta.rest.rowLoopLength * -1 : 0)

    if (currentLoopItem) {
      const loopIndex = options.data.index

      assertOk(loopIndex != null, 'expected loop index to be defined')

      const parents = getParentsLoopItems(currentLoopItem.id, newData.loopItems)
      let parentLoopIndex = currentLoopItem.parentLoopIndex

      parents.reverse()

      for (const parentLoopItem of parents) {
        currentLoopIncrement += getLoopItemTemplateLength(parentLoopItem) * parentLoopIndex
        parentLoopIndex = parentLoopItem.parentLoopIndex
      }

      const templateLength = getLoopItemTemplateLength(currentLoopItem)

      currentLoopIncrement = currentLoopIncrement + (templateLength * loopIndex)
    }

    const increment = previousLoopIncrement + currentLoopIncrement

    newData.originalRowNumber = originalRowNumber
    newData.r = originalRowNumber + increment
    // only a value that represents the increment of previous loops defined before the cell
    newData.previousLoopIncrement = previousRootLoopIncrement
    // this is a value that represents all the executions of the current loop (considering nested loops too)
    newData.currentLoopIncrement = currentLoopIncrement + (previousLoopIncrement - previousRootLoopIncrement)

    newData.columnLetter = null
    newData.originalCellRef = null
    newData.currentCellRef = null

    const result = options.fn(this, { data: newData })

    return result
  }

  function c (info, options) {
    const originalRowNumber = options.data.originalRowNumber
    const rowNumber = options.data.r
    const trackedCells = options.data.meta.trackedCells
    const originalCellLetter = options.hash.o
    const { calcChainUpdate } = info

    assertOk(originalRowNumber != null, 'originalRowNumber needs to exists on internal data')
    assertOk(rowNumber != null, 'rowNumber needs to exists on internal data')
    assertOk(trackedCells != null, 'trackedCells needs to exists on internal data')

    const { parseCellRef } = require('cellUtils')
    const originalCellRef = `${originalCellLetter}${originalRowNumber}`
    const updatedCellRef = `${originalCellLetter}${rowNumber}`

    // keeping the lastCellRef updated
    if (options.data.meta.lastCellRef == null) {
      options.data.meta.lastCellRef = updatedCellRef
    } else {
      const parsedLastCellRef = parseCellRef(options.data.meta.lastCellRef)
      const parsedUpdatedCellRef = parseCellRef(updatedCellRef)

      if (
        (parsedUpdatedCellRef.rowNumber === parsedLastCellRef.rowNumber &&
        parsedUpdatedCellRef.columnNumber > parsedLastCellRef.columnNumber) ||
        (parsedUpdatedCellRef.rowNumber > parsedLastCellRef.rowNumber)
      ) {
        options.data.meta.lastCellRef = updatedCellRef
      }
    }

    let shouldUpdateOriginalCell

    // if we are in loop then don't add item to updatedOriginalCells
    if (options.data.currentLoopId != null) {
      shouldUpdateOriginalCell = false
    } else {
      shouldUpdateOriginalCell = originalCellRef !== updatedCellRef && options.data.meta.updatedOriginalCells[originalCellRef] == null
    }

    if (shouldUpdateOriginalCell) {
      // keeping a registry of the original cells that were updated
      options.data.meta.updatedOriginalCells[originalCellRef] = updatedCellRef
    }

    trackedCells[originalCellRef] = trackedCells[originalCellRef] || { first: null, last: null, count: 0 }

    if (trackedCells[originalCellRef].inLoop == null) {
      trackedCells[originalCellRef].inLoop = options.data.currentLoopId != null
    }

    if (trackedCells[originalCellRef].first == null) {
      trackedCells[originalCellRef].first = updatedCellRef
    }

    trackedCells[originalCellRef].last = updatedCellRef
    trackedCells[originalCellRef].count += 1

    if (calcChainUpdate) {
      const sheetId = options.data.sheetId

      const cellRefKey = `${sheetId}-${originalCellRef}`

      let calcChainUpdatesForCellRef = options.data.calcChainUpdatesMap.get(cellRefKey)

      if (calcChainUpdatesForCellRef == null) {
        calcChainUpdatesForCellRef = []
        options.data.calcChainUpdatesMap.set(cellRefKey, calcChainUpdatesForCellRef)
      }

      calcChainUpdatesForCellRef.push(updatedCellRef)
    }

    options.data.columnLetter = originalCellLetter
    options.data.originalCellRef = originalCellRef
    options.data.currentCellRef = updatedCellRef

    return updatedCellRef
  }

  function cellValue (options) {
    const Handlebars = require('handlebars')
    const newData = Handlebars.createFrame(options.data)

    newData.currentCellValueInfo = {}

    if (Object.prototype.hasOwnProperty.call(options.hash, 'value')) {
      newData.currentCellValueInfo.value = options.hash.value

      let toEscape = false

      // escape should be there when the original handlebars expression was intended
      // to be escaped, we preserve that intend here and escape it, we need to do this
      // because handlebars does not escape automatically the helper parameter hash,
      // which we use as an implementation detail of our auto detect cell type logic
      if (Object.prototype.hasOwnProperty.call(options.hash, 'escape')) {
        toEscape = options.hash.escape === true && typeof newData.currentCellValueInfo.value === 'string'
      }

      if (toEscape) {
        newData.currentCellValueInfo.value = Handlebars.escapeExpression(newData.currentCellValueInfo.value)
      }
    }

    const result = options.fn(this, { data: newData })
    const enabledForCol = newData.meta.autofit.enabledFor[0] === true ? true : newData.meta.autofit.enabledFor.includes(newData.columnLetter)

    if (enabledForCol) {
      const pixelWidth = require('string-pixel-width')
      const fontSize = options.hash.fontSize
      const fontSizeInPx = fontSize * (96 / 72)
      const currentValue = newData.currentCellValueInfo.value
      const maxInfo = newData.meta.autofit.cols[newData.columnLetter]

      const size = pixelWidth(currentValue, { font: 'Arial', size: fontSizeInPx })

      if (maxInfo == null) {
        newData.meta.autofit.cols[newData.columnLetter] = {
          value: currentValue,
          size
        }
      } else if (size > maxInfo.size) {
        newData.meta.autofit.cols[newData.columnLetter] = {
          value: currentValue,
          size
        }
      }
    }

    return result
  }

  function cellValueRaw (options) {
    const Handlebars = require('handlebars')
    const newData = Handlebars.createFrame(options.data)
    const result = options.fn(this, { data: newData })

    if (
      options?.data?.currentCellValueInfo != null &&
      !Object.prototype.hasOwnProperty.call(options.data.currentCellValueInfo, 'value')
    ) {
      options.data.currentCellValueInfo.value = result
    }

    return ''
  }

  function cellValueType (options) {
    const cellValue = options.data.currentCellValueInfo.value
    let cellType

    if (cellValue == null) {
      cellType = 'inlineStr'
    } else if (
      typeof cellValue === 'boolean' ||
      (
        cellValue != null &&
        typeof cellValue === 'object' &&
        Object.prototype.toString.call(cellValue) === '[object Boolean]'
      )
    ) {
      cellType = 'b'
    } else if (
      typeof cellValue === 'number' ||
      (
        cellValue != null &&
        typeof cellValue === 'object' &&
        Object.prototype.toString.call(cellValue) === '[object Number]'
      )
    ) {
      cellType = 'n'
    } else {
      cellType = 'inlineStr'
    }

    options.data.currentCellValueInfo.type = cellType

    return cellType
  }

  function cellContent (options) {
    const Handlebars = require('handlebars')
    const cellType = options.data.currentCellValueInfo.type
    const cellValue = options.data.currentCellValueInfo.value
    let result

    if (cellType === 'inlineStr') {
      result = `<is><t>${cellValue == null ? '' : cellValue}</t></is>`
    } else if (cellType === 'b') {
      result = `<v>${cellValue ? '1' : '0'}</v>`
    } else if (cellType === 'n') {
      result = `<v>${cellValue}</v>`
    }

    assertOk(result != null, `cell type "${cellType}" not supported`)

    return new Handlebars.SafeString(result)
  }

  function mergeOrFormulaCell (type, options) {
    const rowNumber = options.data.r

    assertOk(rowNumber != null, 'rowNumber needs to exists on internal data')

    let output = ''

    if (type === 'mergeCell') {
      const originalCellRefRange = options.hash.originalCellRefRange

      assertOk(originalCellRefRange != null, 'originalCellRefRange arg is required')

      const { evaluateCellRefsFromExpression, generateNewCellRefFromRow } = require('cellUtils')

      const { newValue } = evaluateCellRefsFromExpression(originalCellRefRange, (cellRefInfo) => {
        const isRange = cellRefInfo.type === 'rangeStart' || cellRefInfo.type === 'rangeEnd'

        assertOk(isRange, `cell ref expected to be a range. value: "${originalCellRefRange}`)

        const increment = cellRefInfo.type === 'rangeEnd' ? cellRefInfo.parsedRangeEnd.rowNumber - cellRefInfo.parsedRangeStart.rowNumber : 0

        const newCellRef = generateNewCellRefFromRow(cellRefInfo.parsed, rowNumber + increment)

        return newCellRef
      })

      const mergeCell = {
        original: originalCellRefRange,
        value: newValue
      }

      options.data.meta.mergeCells.push(mergeCell)
    } else {
      const currentCellRef = options.data.currentCellRef
      const trackedCells = options.data.meta.trackedCells
      const lazyFormulas = options.data.meta.lazyFormulas
      const originalCellRef = options.data.originalCellRef
      const originalFormula = options.hash.o
      const previousLoopIncrement = options.data.previousLoopIncrement
      const currentLoopIncrement = options.data.currentLoopIncrement

      assertOk(currentCellRef != null, 'currentCellRef needs to exists on internal data')
      assertOk(trackedCells != null, 'trackedCells needs to exists on internal data')
      assertOk(lazyFormulas != null, 'lazyFormulas needs to exists on internal data')
      assertOk(originalCellRef != null, 'originalCellRef needs to exists on internal data')
      assertOk(originalFormula != null, 'originalFormula arg is required')
      assertOk(currentLoopIncrement != null, 'currentLoopIncrement needs to exists on internal data')

      const { parseCellRef, getNewFormula } = require('cellUtils')
      const parsedOriginCellRef = parseCellRef(originalCellRef)
      const originCellIsFromLoop = options.data.currentLoopId != null

      const { formula: newFormula } = getNewFormula(originalFormula, parsedOriginCellRef, {
        type: 'normal',
        originCellIsFromLoop,
        previousLoopIncrement,
        currentLoopIncrement,
        trackedCells,
        includeLoopIncrementResolver: (cellRefIsFromLoop, cellRefInfo) => {
          return (
            cellRefIsFromLoop &&
            trackedCells[cellRefInfo.localRef] != null &&
            trackedCells[cellRefInfo.localRef].loopHierarchyId === getCurrentLoopItem(options.data.currentLoopId, options.data.loopItems)?.hierarchyId
          )
        },
        lazyFormulas,
        currentCellRef
      })

      output = newFormula
    }

    return output
  }

  function mergeCells (options) {
    const Handlebars = require('handlebars')
    const targetItems = options.data.meta.mergeCells
    const newData = Handlebars.createFrame(options.data)

    newData.mergeCellsCount = targetItems.length
    newData.mergeCellsTemplates = Object.create(null)

    return options.fn(this, { data: newData })
  }

  function mergeCellsItems (options) {
    const Handlebars = require('handlebars')
    const targetItems = options.data.meta.mergeCells

    // run the body to fulfill the merge cells templates
    options.fn(this)

    const mergeCellsTemplates = options.data.mergeCellsTemplates

    const updated = []

    for (const targetItem of targetItems) {
      const template = mergeCellsTemplates[targetItem.original]
      const output = template({ newRef: targetItem.value })
      updated.push(output)
    }

    return new Handlebars.SafeString(updated.join('\n'))
  }

  function mergeCellItem (options) {
    const originalCellRefRange = options.hash.originalCellRefRange

    assertOk(originalCellRefRange != null, 'originalCellRefRange arg is required')

    options.data.mergeCellsTemplates[originalCellRefRange] = options.fn

    return ''
  }

  function formulaShared (options) {
    const rowNumber = options.data.r

    assertOk(rowNumber != null, 'rowNumber needs to exists on internal data')

    const originalSharedRefRange = options.hash.o

    assertOk(originalSharedRefRange != null, 'originalSharedRefRange arg is required')

    const { evaluateCellRefsFromExpression, generateNewCellRefFromRow } = require('cellUtils')

    const { newValue } = evaluateCellRefsFromExpression(originalSharedRefRange, (cellRefInfo) => {
      const newCellRef = generateNewCellRefFromRow(cellRefInfo.parsed, rowNumber)
      return newCellRef
    })

    return newValue
  }

  // TODO: this should be refactored at some point to be more generic
  // and support nested loops, maybe the logic will be similar to mergeCell or formula helpers
  // when this is done we can remove all the methods that are only used here "getNewCellRef", "getCurrentAndPreviousLoopItemsByTarget"
  function newCellRef (options) {
    const Handlebars = require('handlebars')
    const updatedOriginalCells = options.data.meta.updatedOriginalCells
    const loopItems = options.data.loopItems
    let targetItems = []
    const updated = []
    const type = 'newCellRef'

    if (type === 'newCellRef') {
      targetItems = [{ value: options.hash.originalCellRefRange }]
    }

    for (const targetItem of targetItems) {
      const regexp = /(\$?[A-Z]+\$?\d+:)?(\$?[A-Z]+\$?\d+)/g

      const newValue = targetItem.value.replace(regexp, (...args) => {
        const [match, _startingCellRef, endingCellRef] = args
        const isRange = _startingCellRef != null
        let newCellRef

        const ctx = {
          updatedOriginalCells,
          loopItems
        }

        if (isRange) {
          const startingCellRef = _startingCellRef.slice(0, -1)
          const newStartingCellRef = getNewCellRef(type === 'formulas' ? [targetItem.cellRef, startingCellRef] : startingCellRef, targetItem.loopMeta, 'rangeStart', ctx)
          const newEndingCellRef = getNewCellRef(type === 'formulas' ? [targetItem.cellRef, endingCellRef] : endingCellRef, targetItem.loopMeta, 'rangeEnd', ctx)

          return `${newStartingCellRef}:${newEndingCellRef}`
        } else {
          newCellRef = getNewCellRef(type === 'formulas' ? [targetItem.cellRef, endingCellRef] : endingCellRef, targetItem.loopMeta, 'standalone', ctx)
        }

        return newCellRef
      })

      if (type === 'newCellRef') {
        updated.push(newValue)
      }
    }

    return new Handlebars.SafeString(updated.join('\n'))
  }

  function autofit (options) {
    const Handlebars = require('handlebars')
    const result = []
    const autofitInfo = options.data.meta.autofit

    for (const [colLetter, colInfo] of Object.entries(autofitInfo.cols)) {
      result.push(`<col ref="${colLetter}" size="${colInfo.size}" />`)
    }

    return new Handlebars.SafeString(result.join('\n'))
  }

  function lazyFormulas (options) {
    const Handlebars = require('handlebars')
    const trackedCells = options.data.meta.trackedCells
    const lazyFormulas = options.data.meta.lazyFormulas

    assertOk(trackedCells != null, 'trackedCells needs to exists on internal data')
    assertOk(lazyFormulas != null, 'lazyFormulas needs to exists on internal data')

    if (lazyFormulas.count == null || lazyFormulas.count === 0) {
      return new Handlebars.SafeString('')
    }

    const result = []

    const lazyFormulaIds = Object.keys(lazyFormulas.data)

    const { getNewFormula } = require('cellUtils')

    for (const lazyFormulaId of lazyFormulaIds) {
      const lazyFormulaInfo = lazyFormulas.data[lazyFormulaId]

      const {
        formula,
        parsedOriginCellRef,
        originCellIsFromLoop,
        previousLoopIncrement,
        currentLoopIncrement,
        cellRefs
      } = lazyFormulaInfo

      const { formula: newFormula } = getNewFormula(formula, parsedOriginCellRef, {
        type: 'lazy',
        originCellIsFromLoop,
        previousLoopIncrement,
        currentLoopIncrement,
        trackedCells,
        lazyCellRefs: cellRefs
      })

      result.push(`<item id="${lazyFormulaId}">${newFormula}</item>`)
    }

    return new Handlebars.SafeString(`<lazyFormulas>${result.join('\n')}</lazyFormulas>`)
  }

  function calcChain (options) {
    const processCalcChain = require('xlsxProcessCalcChain')

    const existingCalcChainXml = options.fn(this)

    return processCalcChain(options.data.calcChainUpdatesMap, existingCalcChainXml)
  }

  function raw (options) {
    return options.fn()
  }

  function getLoopItemById (byTarget, loopItems) {
    assertOk(byTarget != null, 'getLoopItemById byTarget arg is required')
    assertOk(Array.isArray(loopItems), 'getLoopItemById loopItems arg is invalid')

    const { idName, idValue } = byTarget

    assertOk(idName != null, 'getLoopItemById byTarget.idName arg is required')
    assertOk(typeof idName === 'string', 'getLoopItemById byTarget.idName arg is invalid')
    assertOk(idName === 'hierarchyId' || idName === 'id', 'getLoopItemById byTarget.idName should be either "hierarchyId" or "id"')
    assertOk(idValue != null, 'getLoopItemById byTarget.idValue arg is required')
    assertOk(typeof idValue === 'string', 'getLoopItemById byTarget.idValue arg is invalid')

    const idParts = idValue.split('#')
    let ctx = { children: loopItems }
    let targetIdValue = ''
    let parent

    while (idParts.length > 0) {
      const idx = idParts.shift()

      targetIdValue = targetIdValue !== '' ? `${targetIdValue}#${idx}` : `${idx}`

      const matches = ctx.children.filter((c) => c[idName] === targetIdValue)
      const result = matches[matches.length - 1]

      if (result == null) {
        break
      }

      ctx = result

      if (idParts.length === 0) {
        parent = ctx
      }
    }

    return parent
  }

  function getParentLoopItemByHierarchy (childLoopItem, loopItems) {
    assertOk(childLoopItem != null, 'getParentLoopItemByHierarchy childLoopItem arg is required')
    assertOk(Array.isArray(loopItems), 'getParentLoopItemByHierarchy loopItems arg is invalid')

    const parentHierarchyId = childLoopItem.hierarchyId.split('#').slice(0, -1).join('#')

    if (parentHierarchyId === '') {
      return
    }

    return getLoopItemById({ idName: 'hierarchyId', idValue: parentHierarchyId }, loopItems)
  }

  function getCurrentLoopItem (loopId, loopItems) {
    assertOk(Array.isArray(loopItems), 'getCurrentLoopItem loopItems arg is invalid')

    if (loopId == null) {
      return
    }

    return getLoopItemById({ idName: 'id', idValue: loopId }, loopItems)
  }

  function getPreviousLoopItems (loopId, evaluatedLoopsIds, loopItems) {
    assertOk(Array.isArray(evaluatedLoopsIds), 'getPreviousLoopItems evaluatedLoopsIds arg is invalid')
    assertOk(Array.isArray(loopItems), 'getPreviousLoopItems loopItems arg is invalid')

    const lastEvaluatedLoopId = evaluatedLoopsIds[evaluatedLoopsIds.length - 1]
    const loopItemsToGet = loopId != null && loopId === lastEvaluatedLoopId ? evaluatedLoopsIds.slice(0, -1) : evaluatedLoopsIds
    const result = []

    for (const lId of loopItemsToGet) {
      const loopItem = getLoopItemById({ idName: 'id', idValue: lId }, loopItems)

      assertOk(loopItem != null, `Can not find loop item by id "${lId}"`)

      if (!loopItem.completed) {
        continue
      }

      result.push(loopItem)
    }

    return result
  }

  function getCurrentAndPreviousLoopItemsByTarget (byTarget, loopItems) {
    assertOk(byTarget != null, 'getCurrentAndPreviousLoopItemsByTarget byTarget arg is invalid')
    assertOk(byTarget.rowNumber != null, 'getCurrentAndPreviousLoopItemsByTarget byTarget.rowNumber arg is required')
    assertOk(byTarget.columnNumber != null, 'getCurrentAndPreviousLoopItemsByTarget byTarget.columnNumber arg is required')
    assertOk(Array.isArray(loopItems), 'getCurrentAndPreviousLoopItemsByTarget loopItems arg is invalid')

    const { rowNumber, columnNumber } = byTarget

    const matchedLoopItems = loopItems.filter((item) => {
      assertOk(item.completed, 'getCurrentAndPreviousLoopItemsByTarget invalid usage, it should be called only after all loop items are completed evaluated')
      return item.start <= rowNumber
    })

    let current
    const previousAll = [...matchedLoopItems]
    const targetLoopItem = previousAll[previousAll.length - 1]
    const previous = previousAll.slice(0, -1)

    if (targetLoopItem != null) {
      let isInside = false
      const limit = targetLoopItem.type === 'block' ? targetLoopItem.end : targetLoopItem.start

      if (rowNumber === limit) {
        // for row loops we assume the row is inside when the row just matches the limit
        // (even if technically on the out of loop right case we should check columnEnd,
        // we don't do that because in that case the cell will anyway keep on its original place)
        isInside = targetLoopItem.type === 'block' ? targetLoopItem.columnEnd > columnNumber : true
      } else {
        isInside = limit > rowNumber
      }

      if (!isInside) {
        previous.push(targetLoopItem)
      } else {
        current = targetLoopItem
      }
    }

    return {
      current,
      previousAll,
      previous
    }
  }

  function getLoopItemTemplateLength (loopItem) {
    assertOk(loopItem != null, 'getLoopItemTemplateLength loopItem arg is invalid')

    let templateLength = 1

    if (loopItem.type === 'block') {
      templateLength = (loopItem.end - loopItem.start) + 1
    }

    return templateLength
  }

  function getParentsLoopItems (loopId, loopItems) {
    assertOk(loopId != null, 'getParentsLoopItems loopId arg is invalid')
    assertOk(Array.isArray(loopItems), 'getParentsLoopItems loopItems arg is invalid')

    const results = []
    const parentIdParts = loopId.split('#').slice(0, -1)

    if (parentIdParts.length === 0) {
      return results
    }

    let parentId = ''

    for (let index = 0; index < parentIdParts.length; index++) {
      parentId += parentId === '' ? parentIdParts[index] : `#${parentIdParts[index]}`

      const result = getLoopItemById({ idName: 'id', idValue: parentId }, loopItems)

      assertOk(result != null, `Can not find loop item by id "${parentId}"`)

      results.push(result)
    }

    return results
  }

  function getNewCellRef (cellRefInput, originLoopMeta, mode = 'standalone', context) {
    const type = 'newCellRef'
    const { updatedOriginalCells, loopItems } = context
    let cellRef
    let originCellRef

    if (Array.isArray(cellRefInput)) {
      originCellRef = cellRefInput[0]
      cellRef = cellRefInput[1]
    } else {
      cellRef = cellRefInput
    }

    const { parseCellRef } = require('cellUtils')
    const parsedCellRef = parseCellRef(cellRef)
    const parsedOriginCellRef = originCellRef != null ? parseCellRef(originCellRef) : undefined
    const normalizedCellRef = cellRef.replace('$', '')
    let newCellRef = updatedOriginalCells[normalizedCellRef]
    let currentLoopItem

    if (newCellRef == null) {
      // if not found on original cells then do a check if we find
      // matched loop items for the referenced row numbers
      const {
        current: currentLoopItemForTarget, previousAll: previousAllLoopItemsForTarget, previous: previousLoopItemsForTarget
      } = getCurrentAndPreviousLoopItemsByTarget({
        rowNumber: parsedCellRef.rowNumber,
        columnNumber: parsedCellRef.columnNumber
      }, loopItems)

      currentLoopItem = currentLoopItemForTarget

      if (currentLoopItemForTarget != null || previousLoopItemsForTarget.length > 0) {
        const originIsLoopItem = parsedOriginCellRef == null
          ? false
          : getCurrentAndPreviousLoopItemsByTarget({
            rowNumber: parsedOriginCellRef.rowNumber,
            columnNumber: parsedOriginCellRef.columnNumber
          }, loopItems).current != null

        const getAfterIncrement = (parsedC, all = false) => {
          const filteredLoopItems = all ? previousAllLoopItemsForTarget : previousLoopItemsForTarget

          const rowMatchedLoopItems = []

          let increment = filteredLoopItems.reduce((acu, item) => {
            let totalAcu = acu

            if (item.type === 'block') {
              totalAcu += getLoopItemTemplateLength(item) * (item.length - 1)
            } else {
              rowMatchedLoopItems.push(item)
              totalAcu += item.length
            }

            return totalAcu
          }, 0)

          increment += rowMatchedLoopItems.length > 0 ? (rowMatchedLoopItems.length * -1) : 0

          return `${parsedC.lockedColumn ? '$' : ''}${parsedC.letter}${parsedC.lockedRow ? '$' : ''}${parsedC.rowNumber + increment}`
        }

        let includeAll = false

        if (currentLoopItemForTarget != null &&
          (
            (type === 'newCellRef' && mode === 'rangeEnd') ||
            (type === 'formulas' &&
              originCellRef != null &&
              !originIsLoopItem &&
              mode === 'rangeEnd')
          )) {
          includeAll = true
        }

        newCellRef = getAfterIncrement(parsedCellRef, includeAll)
      } else {
        newCellRef = cellRef
      }
    }

    if (originLoopMeta != null) {
      const parsedNewCellRef = parseCellRef(newCellRef)
      let newRowNumber = parsedNewCellRef.rowNumber

      // when in loop don't increase the row number for locked row references
      if (!parsedNewCellRef.lockedRow) {
        if (currentLoopItem && currentLoopItem.type === 'block') {
          newRowNumber += getLoopItemTemplateLength(currentLoopItem) * originLoopMeta.index
        } else {
          newRowNumber += originLoopMeta.index
        }
      }

      newCellRef = `${parsedNewCellRef.lockedColumn ? '$' : ''}${parsedNewCellRef.letter}${parsedNewCellRef.lockedRow ? '$' : ''}${newRowNumber}`
    }

    return newCellRef
  }

  function assertOk (valid, message) {
    if (!valid) {
      throw new Error(message)
    }
  }

  const helpers = {
    ws,
    sd,
    dimension,
    loop,
    outOfLoop,
    outOfLoopPlaceholder,
    r,
    // normal cell
    c: function (options) {
      return c.call(this, { calcChainUpdate: false }, options)
    },
    // cell with calcChainUpdated
    c1: function (options) {
      return c.call(this, { calcChainUpdate: true }, options)
    },
    cellValue,
    cellValueRaw,
    cellValueType,
    cellContent,
    mergeCell: function (options) {
      return mergeOrFormulaCell.call(this, 'mergeCell', options)
    },
    f: function (options) {
      return mergeOrFormulaCell.call(this, 'formula', options)
    },
    fs: formulaShared,
    mergeCells,
    mergeCellsItems,
    mergeCellItem,
    newCellRef,
    autofit,
    lazyFormulas,
    calcChain,
    raw
  }

  return {
    resolveHelper: (helperName, argumentsLength, context, data, options) => {
      const targetHelper = helpers[helperName]
      const validCall = targetHelper != null ? argumentsLength === targetHelper.length : false

      if (!validCall) {
        throw new Error(`Invalid usage of _D helper${helperName != null ? ` (t: ${helperName})` : ''}`)
      }

      const params = []

      if (targetHelper.length > 1) {
        params.push(data)
        params.push(options)
      } else {
        params.push(options)
      }

      try {
        return targetHelper.apply(context, params)
      } catch (error) {
        throw new Error(`_D t="${helperName}" helper, ${error.message}`)
      }
    },
    assertDataArg: assertOk
  }
})()

function _D (data, options) {
  const optionsToUse = options == null ? data : options
  const type = optionsToUse.hash.t

  __xlsxD.assertDataArg(type != null, '_D helper t arg is required')

  return __xlsxD.resolveHelper(type, arguments.length, this, data, optionsToUse)
}

// alias for {{_D t='c'}} helper call, we do it this way to optimize size of the generated xml
function _C (data, options) {
  options.hash.t = 'c'
  options.hash.o = data
  return _D.call(this, options)
}

// alias for {{_D t='c1'}} helper call, we do it this way to optimize size of the generated xml
function _E (data, options) {
  options.hash.t = 'c1'
  options.hash.o = data
  return _D.call(this, options)
}

// alias for {{_D t='r'}} helper call, we do it this way to optimize size of the generated xml
function _R (data, options) {
  options.hash.t = 'r'
  options.hash.o = data
  return _D.call(this, options)
}
