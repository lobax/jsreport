import React from 'react'
import groupEntitiesByHierarchyHelper from '../../helpers/groupEntitiesByHierarchy'
import getVisibleEntitySetsInTree from '../../helpers/getVisibleEntitySetsInTree'
import { values as configuration } from '../../lib/configuration'

export function pointIsInsideContainer (containerDimensions, point) {
  const insideX = point.x >= containerDimensions.left && point.x <= (containerDimensions.left + containerDimensions.width)
  const insideY = point.y >= containerDimensions.top && point.y <= (containerDimensions.top + containerDimensions.height)

  return insideX && insideY
}

export function groupEntitiesByType (entitySets, entitiesByType) {
  const setsToRender = getSetsToRender(entitySets)

  return setsToRender.map((entitiesType) => ({
    name: entitiesType,
    isEntitySet: true,
    items: entitiesByType[entitiesType].map((entity) => ({
      name: entity.name,
      data: entity
    }))
  }))
}

export function groupEntitiesByHierarchy (entitySets, entitiesByType) {
  return groupEntitiesByHierarchyHelper(Object.keys(entitySets), entitiesByType)
}

export function getSetsToRender (entitySets) {
  const setsNames = getVisibleEntitySetsInTree(entitySets).map((s) => s.name)

  let setsInOrderSpecification = []

  const setsNotInOrderSpecification = setsNames.filter((setName) => {
    const indexInOrder = configuration.entityTreeOrder.indexOf(setName)
    const found = indexInOrder !== -1

    if (found) {
      // make sure to only add set names present in entitySets
      setsInOrderSpecification.push({
        idx: indexInOrder,
        name: setName
      })
    }

    return !found
  })

  setsInOrderSpecification = setsInOrderSpecification.sort((a, b) => {
    if (a.idx > b.idx) {
      return 1
    }

    if (a.idx < b.idx) {
      return -1
    }

    return 0
  }).map((setInfo) => setInfo.name)

  return [...setsInOrderSpecification, ...setsNotInOrderSpecification]
}

export function checkIsGroupNode (node) {
  return node.isEntitySet === true || node.isGroup === true
}

export function checkIsGroupEntityNode (node) {
  if (checkIsGroupNode(node)) {
    return node.isEntity === true
  }

  return false
}

export function getNodeId (name, entity, parentId, depth) {
  let id

  if (parentId != null) {
    id = `${parentId}--${name}`
  } else {
    id = name
  }

  if (entity) {
    id = `${id}-${entity.shortid}`
  }

  if (depth <= 0) {
    depth = 0
  }

  if (!entity) {
    id += '--group'
  } else {
    id += `--${entity.__entitySet}`
  }

  id += `--${depth}`

  return id
}

export function getNodeDOMId (entity) {
  let currentF = entity.folder
  let hierarchy = ''

  while (currentF != null) {
    hierarchy += `--${currentF.shortid}`
    currentF = currentF.folder
  }

  return `entityNode--${entity.__entitySet}--${entity.shortid}${hierarchy}`
}

export function getNodeTitleDOMId (entity) {
  const nodeDOMId = getNodeDOMId(entity)

  if (!nodeDOMId) {
    return undefined
  }

  return `${nodeDOMId}--title`
}

export function getAllEntitiesInHierarchy (node, includeRoot, onlyDirectChildren, allEntities) {
  const entities = allEntities == null ? [] : allEntities

  if (!node) {
    return entities
  }

  if (includeRoot === true) {
    if (checkIsGroupNode(node)) {
      if (checkIsGroupEntityNode(node)) {
        entities.push(node.data._id)
      }
    } else {
      entities.push(node.data._id)
    }
  }

  if (node.items) {
    node.items.forEach((cNode) => {
      const nodeToEvaluate = onlyDirectChildren === true ? Object.assign({}, cNode, { items: null }) : cNode

      return getAllEntitiesInHierarchy(nodeToEvaluate, true, false, entities)
    })
  }

  return entities
}

export function renderEntityTreeItemComponents (position, propsToItem, originalChildren) {
  if (position === 'container') {
    // if there are no components registered, defaults to original children
    if (!configuration.entityTreeItemComponents[position].length) {
      return originalChildren
    }

    // composing components when position is container
    const wrappedItemElement = configuration.entityTreeItemComponents[position].reduce((prevElement, b) => {
      if (prevElement == null) {
        return React.createElement(b, propsToItem, originalChildren)
      }

      return React.createElement(b, propsToItem, prevElement)
    }, null)

    if (!wrappedItemElement) {
      return null
    }

    return wrappedItemElement
  }

  return configuration.entityTreeItemComponents[position].map((p, i) => (
    React.createElement(p, {
      key: i,
      ...propsToItem
    }))
  )
}
