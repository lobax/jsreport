const PdfManipulator = require('./pdfManipulator')

module.exports = async (inputs, reporter, req, res) => {
  const pdfUtilsProfilerEvent = reporter.profiler.emit({
    type: 'operationStart',
    subtype: 'pdfUtils',
    name: 'pdf utils'
  }, req, res)

  const { pdfContent, operations, pdfMeta, pdfPassword, pdfSign, pdfA, pdfAccessibility, outlines, removeHiddenMarks } = inputs

  const runRender = async (shortidOrTemplate, data) => {
    let templateToUse

    if (typeof shortidOrTemplate === 'string') {
      templateToUse = { shortid: shortidOrTemplate }
    } else {
      templateToUse = { ...shortidOrTemplate }
    }

    const res = await reporter.render({ template: templateToUse, data, options: { pdfUtils: { removeHiddenMarks: false } } }, req)
    return res.content
  }

  const pdfBuf = pdfContent
  const manipulator = PdfManipulator(pdfBuf, { pdfMeta, pdfPassword, pdfSign, outlines, pdfA, pdfAccessibility, removeHiddenMarks, hiddenPageFields: req.context.shared.pdfUtilsHiddenPageFields })
  const operationsToProcess = operations.filter(o => o.templateShortid || o.template)

  reporter.logger.debug(`pdf-utils detected ${operationsToProcess.length} pdf operation(s) to process`, req)

  for (const operation of operationsToProcess) {
    if (operation.enabled === false) {
      reporter.logger.debug(`Skipping disabled pdf operation ${operation.type}`, req)
      continue
    }
    console.time('parse')
    await manipulator.parse({
      hiddenPageFields: req.context.shared.pdfUtilsHiddenPageFields
    })
    console.timeEnd('parse')

    let templateDef

    if (operation.templateShortid) {
      templateDef = operation.templateShortid
    } else {
      templateDef = operation.template
    }

    reporter.logger.debug(`pdf-utils running pdf operation ${operation.type}`, req)

    if (operation.type === 'append') {
      const profilerEvent = reporter.profiler.emit({
        type: 'operationStart',
        subtype: 'pdfUtilsAppend',
        name: 'pdf utils append',
        previousOperationId: pdfUtilsProfilerEvent.operationId
      }, req, res)
      const r = await runRender(templateDef, { $pdf: { pages: manipulator.parsedPdf.pages } })
      console.time('append')
      await manipulator.append(r)
      console.timeEnd('append')
      reporter.profiler.emit({
        type: 'operationEnd',
        operationId: profilerEvent.operationId
      }, req, res)
      continue
    }

    if (operation.type === 'prepend') {
      const profilerEvent = reporter.profiler.emit({
        type: 'operationStart',
        subtype: 'pdfUtilsPrepend',
        name: 'pdf utils append',
        previousOperationId: pdfUtilsProfilerEvent.operationId
      }, req, res)
      await manipulator.prepend(await runRender(templateDef, { $pdf: { pages: manipulator.parsedPdf.pages } }))
      reporter.profiler.emit({
        type: 'operationEnd',
        operationId: profilerEvent.operationId
      }, req, res)
      continue
    }

    if (operation.type === 'merge') {
      const profilerEvent = reporter.profiler.emit({
        type: 'operationStart',
        subtype: 'pdfUtilsMerge',
        name: 'pdf utils merge',
        previousOperationId: pdfUtilsProfilerEvent.operationId
      }, req, res)
      if (operation.mergeWholeDocument) {
        const mergeBuffer = await runRender(templateDef, { $pdf: { pages: manipulator.parsedPdf.pages } })
        console.time('merge')
        await manipulator.merge(mergeBuffer, operation.mergeToFront)
        console.timeEnd('merge')
        reporter.profiler.emit({
          type: 'operationEnd',
          operationId: profilerEvent.operationId
        }, req, res)
        continue
      }

      const singleMergeBuffer = !operation.renderForEveryPage
        ? await runRender(templateDef, { $pdf: { pages: manipulator.parsedPdf.pages } })
        : null

      const pagesBuffers = []

      for (let i = 0; i < manipulator.parsedPdf.pages.length; i++) {
        if (!singleMergeBuffer && manipulator.parsedPdf.pages[i].group) {
          reporter.logger.debug(`pdf-utils invokes merge with group ${manipulator.parsedPdf.pages[i].group}`, req)
        }

        pagesBuffers[i] = singleMergeBuffer || await runRender(templateDef, {
          $pdf: {
            pages: manipulator.parsedPdf.pages,
            pageIndex: i,
            pageNumber: i + 1
          }
        })
      }

      await manipulator.merge(pagesBuffers, operation.mergeToFront)
      reporter.profiler.emit({
        type: 'operationEnd',
        operationId: profilerEvent.operationId
      }, req, res)
      continue
    }
  }

  reporter.logger.debug('pdf-utils postproces start', req)
  console.time('postprocess')
  await manipulator.postprocess({
    hiddenPageFields: req.context.shared.pdfUtilsHiddenPageFields
  })
  console.timeEnd('postprocess')
  reporter.logger.debug('pdf-utils postproces end', req)

  reporter.profiler.emit({
    type: 'operationEnd',
    operationId: pdfUtilsProfilerEvent.operationId
  }, req, res)

  req.context.profiling.lastOperationId = pdfUtilsProfilerEvent.operationId

  try {
    console.time('toBuffer')
    return manipulator.toBuffer()
  } finally {
    console.timeEnd('toBuffer')
  }
}
