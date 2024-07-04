const { DOMParser } = require('@xmldom/xmldom')
const { col2num } = require('xlsx-coordinates')
const recursiveStringReplaceAsync = require('../../recursiveStringReplaceAsync')
const stringReplaceAsync = require('../../stringReplaceAsync')
const { nodeListToArray, isWorksheetFile, serializeXml, getSheetInfo } = require('../../utils')

module.exports = async (files) => {
  const workbookPath = 'xl/workbook.xml'
  const workbookDoc = files.find((f) => f.path === workbookPath).doc
  const workbookRelsDoc = files.find((file) => file.path === 'xl/_rels/workbook.xml.rels').doc
  const workbookSheetsEls = nodeListToArray(workbookDoc.getElementsByTagName('sheet'))
  const workbookRelsEls = nodeListToArray(workbookRelsDoc.getElementsByTagName('Relationship'))

  for (const sheetFile of files.filter((f) => isWorksheetFile(f.path))) {
    const sheetInfo = getSheetInfo(sheetFile.path, workbookSheetsEls, workbookRelsEls)

    if (sheetInfo == null) {
      throw new Error(`Could not find sheet info for sheet at ${sheetFile.path}`)
    }



    // check if we need to updates tables
    sheetFile.data = await recursiveStringReplaceAsync(
      sheetFile.data.toString(),
      '<tablesUpdated>',
      '</tablesUpdated>',
      'g',
      async (val, content, hasNestedMatch) => {
        if (hasNestedMatch) {
          return val
        }

        const doc = new DOMParser().parseFromString(val)
        const tablesUpdatedEl = doc.documentElement
        const tableUpdatedEls = nodeListToArray(tablesUpdatedEl.getElementsByTagName('tableUpdated'))

        for (const tableUpdatedEl of tableUpdatedEls) {
          const tableDoc = files.find((f) => f.path === tableUpdatedEl.getAttribute('file'))?.doc

          if (tableDoc == null) {
            continue
          }

          tableDoc.documentElement.setAttribute('ref', tableUpdatedEl.getAttribute('ref'))

          const autoFilterEl = tableDoc.getElementsByTagName('autoFilter')[0]
          const autoFilterRefUpdatedEl = nodeListToArray(tableUpdatedEl.childNodes).find((el) => el.nodeName === 'autoFilterRef')

          if (autoFilterEl != null && autoFilterRefUpdatedEl != null) {
            autoFilterEl.setAttribute('ref', autoFilterRefUpdatedEl.getAttribute('ref'))
          }
        }

        return ''
      }
    )

    const autofitCols = {}

    // check if we need to update the cols with autofit information
    sheetFile.data = await recursiveStringReplaceAsync(
      sheetFile.data.toString(),
      '<autofitUpdated>',
      '</autofitUpdated>',
      'g',
      async (val, content, hasNestedMatch) => {
        if (hasNestedMatch) {
          return val
        }

        const doc = new DOMParser().parseFromString(val)
        const autofitUpdatedEl = doc.documentElement
        const colEls = nodeListToArray(autofitUpdatedEl.getElementsByTagName('col'))

        for (const colEl of colEls) {
          const letter = colEl.getAttribute('ref')
          const size = parseFloat(colEl.getAttribute('size'))
          autofitCols[letter] = size
        }

        return ''
      }
    )

    if (Object.keys(autofitCols).length > 0) {
      sheetFile.data = await recursiveStringReplaceAsync(
        sheetFile.data.toString(),
        '<cols>',
        '</cols>',
        'g',
        async (val, content, hasNestedMatch) => {
          if (hasNestedMatch) {
            return val
          }

          const doc = new DOMParser().parseFromString(val)
          const colsEl = doc.documentElement

          const existingColEls = nodeListToArray(colsEl.getElementsByTagName('col'))

          // cleaning
          for (let idx = 0; idx < colsEl.childNodes.length; idx++) {
            const el = colsEl.childNodes[idx]
            colsEl.removeChild(el)
          }

          for (const [colLetter, colPxSize] of Object.entries(autofitCols)) {
            const colSizeInNumberCharactersMDW = (colPxSize / 6.5) + 2 // 2 is for padding
            const colNumber = col2num(colLetter) + 1

            const existingColEl = existingColEls.find((el) => (
              el.getAttribute('min') === colNumber.toString() &&
              el.getAttribute('max') === colNumber.toString()
            ))

            if (existingColEl != null) {
              existingColEl.setAttribute('width', colSizeInNumberCharactersMDW)
              existingColEl.setAttribute('customWidth', '1')
            } else {
              const newCol = doc.createElement('col')
              newCol.setAttribute('min', colNumber.toString())
              newCol.setAttribute('max', colNumber.toString())
              newCol.setAttribute('width', colSizeInNumberCharactersMDW)
              newCol.setAttribute('customWidth', '1')
              colsEl.appendChild(newCol)
            }
          }

          return serializeXml(colsEl)
        }
      )
    }

    const allLazyFormulaEls = {}

    // lazy formulas
    sheetFile.data = await recursiveStringReplaceAsync(
      sheetFile.data.toString(),
      '<lazyFormulas>',
      '</lazyFormulas>',
      'g',
      async (val, content, hasNestedMatch) => {
        if (hasNestedMatch) {
          return val
        }

        const doc = new DOMParser().parseFromString(val)
        const lazyFormulasEl = doc.documentElement
        const itemEls = nodeListToArray(lazyFormulasEl.getElementsByTagName('item'))

        for (const itemEl of itemEls) {
          allLazyFormulaEls[itemEl.getAttribute('id')] = itemEl.textContent
        }

        return ''
      }
    )

    if (Object.keys(allLazyFormulaEls).length > 0) {
      sheetFile.data = await stringReplaceAsync(
        sheetFile.data.toString(),
        /\$lazyFormulaRef[\d]+/g,
        async (lazyFormulaId) => {
          const newFormula = allLazyFormulaEls[lazyFormulaId]

          if (newFormula == null) {
            throw new Error(`Could not find lazyFormula internal data with id "${lazyFormulaId}"`)
          }

          return newFormula
        }
      )
    }
  }
}
