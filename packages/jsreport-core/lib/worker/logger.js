const util = require('util')
const normalizeMetaFromLogs = require('../shared/normalizeMetaFromLogs')
const debug = require('debug')('jsreport')

module.exports = function createLogger (profiler) {
  return {
    debug: (...args) => logFn('debug', profiler, ...args),
    info: (...args) => logFn('info', profiler, ...args),
    warn: (...args) => logFn('warn', profiler, ...args),
    error: (...args) => logFn('error', profiler, ...args)
  }
}

function logFn (level, profiler, ...args) {
  const lastArg = args.slice(-1)[0]
  let req

  if (
    lastArg != null &&
    typeof lastArg === 'object' &&
    lastArg.context != null &&
    lastArg.context.rootId != null
  ) {
    req = lastArg
  }
  console.log('log a message')

  if (req == null) {
    debug(util.format.apply(util, args))
    return
  }

  const msgArgs = args.slice(0, -1)

  const log = {
    timestamp: new Date().getTime(),
    level: level,
    message: util.format.apply(util, msgArgs)
  }

  debug(log.message)

  const meta = normalizeMetaFromLogs(level, log.message, lastArg)

  if (meta != null) {
    log.meta = meta
  }

  return profiler.emit({
    type: 'log',
    ...log
  }, req)
}
