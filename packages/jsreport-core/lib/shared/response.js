const extend = require('node.extend.without.arrays')
const fs = require('fs/promises')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const path = require('path')
const isArrayBufferView = require('util').types.isArrayBufferView

module.exports = (reporter, requestId, obj) => {
  let outputImpl = new BufferOutput(reporter)
  let cachedStream

  const response = {
    meta: extend(true, {}, (obj || {}).meta),

    /** back compatibility methods **/
    get content () {
      return outputImpl.getBufferSync()
    },

    set content (v) {
      outputImpl.setBufferSync(Buffer.from(v))
    },

    get stream () {
      if (cachedStream == null) {
        cachedStream = outputImpl.getStream()
      }

      return cachedStream
    },
    /** //// back compatibility methods **/

    get isInStreamingMode () {
      return outputImpl instanceof StreamOutput
    },

    get __isJsreportResponse__ () {
      return true
    },

    output: {
      async getBuffer () { return outputImpl.getBuffer() },
      async getStream () { return outputImpl.getStream() },
      async getSize () { return outputImpl.getSize() },
      async writeToTempFile (...args) { return outputImpl.writeToTempFile(...args) },
      async update (bufOrStreamOrPath) {
        if (Buffer.isBuffer(bufOrStreamOrPath) || isArrayBufferView(bufOrStreamOrPath)) {
          return outputImpl.setBuffer(bufOrStreamOrPath)
        }

        if (typeof bufOrStreamOrPath === 'string') {
          if (!path.isAbsolute(bufOrStreamOrPath)) {
            throw new Error('Invalid content passed to res.output.update, when content is string it must be an absolute path')
          }

          if (outputImpl instanceof BufferOutput) {
            outputImpl = new StreamOutput(reporter, requestId)
          }

          await reporter.copyFileToTempFile(bufOrStreamOrPath, outputImpl.filePath)
        }

        if (isReadableStream(bufOrStreamOrPath)) {
          if (outputImpl instanceof BufferOutput) {
            outputImpl = new StreamOutput(reporter, requestId)
          }

          return outputImpl.setStream(bufOrStreamOrPath)
        }
      }
    },

    serialize () {
      return {
        meta: this.meta,
        output: outputImpl.serialize()
      }
    },

    async parse (res) {
      Object.assign(this.meta, res.meta)

      if (res.output.type === 'buffer') {
        outputImpl = await BufferOutput.parse(reporter, res.output)
      } else {
        outputImpl = await StreamOutput.parse(reporter, requestId, res.output)
      }
    }
  }

  return response
}

class BufferOutput {
  constructor (reporter) {
    this.reporter = reporter
    this.buffer = Buffer.from([])

    this.getBufferSync = this.getBuffer
    this.setBufferSync = this.setBuffer
  }

  getBuffer () {
    return this.buffer
  }

  setBuffer (buf) {
    // we need to ensure that the buffer is an actually buffer instance,
    // so when receiving Uint8Array we convert it to a buffer
    this.buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  }

  writeToTempFile (tmpNameFn) {
    return this.reporter.writeTempFile(tmpNameFn, this.buffer)
  }

  getSize () {
    return this.buffer.length
  }

  getStream () {
    return Readable.from(this.buffer)
  }

  serialize () {
    const sharedBuf = new SharedArrayBuffer(this.buffer.byteLength)
    const buf = Buffer.from(sharedBuf)

    this.buffer.copy(buf)

    return {
      type: 'buffer',
      content: buf
    }
  }

  static parse (reporter, output) {
    const instance = new BufferOutput(reporter)
    if (output?.content?.length) {
      instance.setBufferSync(Buffer.from(output?.content))
    }
    return instance
  }
}

class StreamOutput {
  constructor (reporter, requestId) {
    this.reporter = reporter
    this.filename = `response-${requestId}.raw-content`
    const { pathToFile } = this.reporter.getTempFilePath(this.filename)
    this.filePath = pathToFile
  }

  async getBuffer () {
    const { content } = await this.reporter.readTempFile(this.filename)
    return content
  }

  setBuffer (buf) {
    return this.reporter.writeTempFile(this.filename, buf)
  }

  getBufferSync () {
    const { content } = this.reporter.readTempFileSync(this.filename)
    return content
  }

  setBufferSync (buf) {
    this.reporter.writeTempFileSync(this.filename, buf)
  }

  writeToTempFile (tmpNameFn) {
    return this.reporter.copyFileToTempFile(this.filePath, tmpNameFn)
  }

  async getSize () {
    const stat = await fs.stat(this.filePath)
    return stat.size
  }

  getStream () {
    const reporter = this.reporter
    const filename = this.filename

    async function * generateResponseContent () {
      const responseFileStream = reporter.readTempFileStream(filename).stream

      for await (const chunk of responseFileStream) {
        yield chunk
      }
    }

    // we produce a new Readable stream to avoid exposing the file stream directly
    return Readable.from(generateResponseContent())
  }

  async setStream (stream) {
    const { stream: responseFileStream } = await this.reporter.writeTempFileStream(this.filename)
    await pipeline(stream, responseFileStream)
  }

  serialize () {
    return {
      type: 'stream',
      filePath: this.filePath
    }
  }

  static async parse (reporter, requestId, output) {
    const instance = new StreamOutput(reporter, requestId)

    if (output.filePath !== instance.filePath) {
      await reporter.copyFileToTempFile(output.filePath, instance.filePath)
    }
    return instance
  }
}

// from https://github.com/sindresorhus/is-stream/blob/main/index.js
function isReadableStream (stream) {
  return (
    stream !== null &&
    typeof stream === 'object' &&
    typeof stream.pipe === 'function' &&
    stream.readable !== false && typeof stream._read === 'function' &&
    typeof stream._readableState === 'object'
  )
}
