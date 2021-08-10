const office = require('@jsreport/office')

module.exports = {
  name: 'html-embedded-in-docx',
  main: 'lib/main.js',
  worker: 'lib/worker.js',
  dependencies: [],
  optionsSchema: office.extendSchema('html-embedded-in-docx', {}),
  requires: {
    core: '2.x.x',
    studio: '2.x.x'
  }
}
