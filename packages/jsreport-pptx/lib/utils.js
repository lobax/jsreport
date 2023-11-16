const { XMLSerializer } = require('@xmldom/xmldom')

function nodeListToArray (nodes) {
  const arr = []
  for (let i = 0; i < nodes.length; i++) {
    arr.push(nodes[i])
  }
  return arr
}

function pxToEMU (val) {
  return Math.round(val * 914400 / 96)
}

function cmToEMU (val) {
  // cm to dxa
  // eslint-disable-next-line no-loss-of-precision
  const dxa = val * 567.058823529411765
  // dxa to EMU
  return Math.round(dxa * 914400 / 72 / 20)
}

function getNewRelIdFromBaseId (relsDoc, itemsMap, baseId) {
  const relationsNodes = nodeListToArray(relsDoc.getElementsByTagName('Relationship'))

  const getId = (id) => {
    const regExp = /^rId(\d+)$/
    const match = regExp.exec(id)

    if (!match || !match[1]) {
      return null
    }

    return parseInt(match[1], 10)
  }

  const maxId = relationsNodes.reduce((lastId, node) => {
    const nodeId = node.getAttribute('Id')
    const num = getId(nodeId)

    if (num == null) {
      return lastId
    }

    if (num > lastId) {
      return num
    }

    return lastId
  }, 0)

  const baseIdNum = getId(baseId)

  if (baseIdNum == null) {
    throw new Error(`Unable to get numeric id from rel id "${baseId}"`)
  }

  let newId = getNewIdFromBaseId(itemsMap, baseIdNum, maxId)

  newId = `rId${newId}`

  return newId
}

function getNewIdFromBaseId (itemsMap, baseId, maxId) {
  const counter = itemsMap.get(baseId) || 0

  itemsMap.set(baseId, counter + 1)

  if (counter === 0) {
    return baseId
  }

  return maxId + 1
}

function getCNvPrEl (graphicFrameEl) {
  const containerEl = nodeListToArray(graphicFrameEl.childNodes).find((node) => node.nodeName === 'p:nvGraphicFramePr')

  if (!containerEl) {
    return
  }

  const cNvPrEl = nodeListToArray(containerEl.childNodes).find((node) => node.nodeName === 'p:cNvPr')

  return cNvPrEl
}

function getChartEl (graphicFrameEl) {
  let parentEl = graphicFrameEl.parentNode

  const graphicEl = nodeListToArray(graphicFrameEl.childNodes).find((node) => node.nodeName === 'a:graphic')

  if (!graphicEl) {
    return
  }

  const graphicDataEl = nodeListToArray(graphicEl.childNodes).find((node) => node.nodeName === 'a:graphicData')

  if (!graphicDataEl) {
    return
  }

  let chartDrawingEl = nodeListToArray(graphicDataEl.childNodes).find((node) => (
    node.nodeName === 'c:chart' || node.nodeName === 'cx:chart'
  ))

  if (!chartDrawingEl) {
    return
  }

  while (parentEl != null) {
    // ignore charts that are part of Fallback tag
    if (parentEl.nodeName === 'mc:Fallback') {
      chartDrawingEl = null
      break
    }

    parentEl = parentEl.parentNode
  }

  return chartDrawingEl
}

function clearEl (el, filterFn) {
  // by default we clear all children
  const testFn = filterFn || (() => false)
  const childEls = nodeListToArray(el.childNodes)

  for (const childEl of childEls) {
    const result = testFn(childEl)

    if (result === true) {
      continue
    }

    childEl.parentNode.removeChild(childEl)
  }
}

function findOrCreateChildNode (docNode, nodeName, targetNode) {
  let result
  const existingNode = findChildNode(nodeName, targetNode)

  if (!existingNode) {
    result = docNode.createElement(nodeName)
    targetNode.appendChild(result)
  } else {
    result = existingNode
  }

  return result
}

function findChildNode (nodeNameOrFn, targetNode, allNodes = false) {
  const result = []

  let testFn

  if (typeof nodeNameOrFn === 'string') {
    testFn = (n) => n.nodeName === nodeNameOrFn
  } else {
    testFn = nodeNameOrFn
  }

  for (let i = 0; i < targetNode.childNodes.length; i++) {
    let found = false
    const childNode = targetNode.childNodes[i]
    const testResult = testFn(childNode)

    if (testResult) {
      found = true
      result.push(childNode)
    }

    if (found && !allNodes) {
      break
    }
  }

  return allNodes ? result : result[0]
}

module.exports.contentIsXML = (content) => {
  if (!Buffer.isBuffer(content) && typeof content !== 'string') {
    return false
  }

  const str = content.toString()

  return str.startsWith('<?xml') || (/^\s*<[\s\S]*>/).test(str)
}

module.exports.serializeXml = (doc) => new XMLSerializer().serializeToString(doc).replace(/ xmlns(:[a-z0-9]+)?=""/g, '')

module.exports.nodeListToArray = nodeListToArray
module.exports.pxToEMU = pxToEMU
module.exports.cmToEMU = cmToEMU
module.exports.getNewRelIdFromBaseId = getNewRelIdFromBaseId
module.exports.getNewIdFromBaseId = getNewIdFromBaseId
module.exports.getCNvPrEl = getCNvPrEl
module.exports.getChartEl = getChartEl
module.exports.clearEl = clearEl
module.exports.findOrCreateChildNode = findOrCreateChildNode
module.exports.findChildNode = findChildNode
