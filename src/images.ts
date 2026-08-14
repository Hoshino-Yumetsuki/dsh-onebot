import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import { Agent, fetch } from 'undici'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'

const IMAGE_MEDIA_TYPES = new Set<ImageMediaType>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
])
const MAX_REDIRECTS = 5
const PUBLIC_IMAGE_AGENT = new Agent({
  connect: {
    async lookup(hostname, options, callback) {
      try {
        const addresses = await lookup(hostname, { all: true, verbatim: true })
        const publicAddresses = addresses.filter(({ address }) => isPublicAddress(address))
        if (publicAddresses.length !== addresses.length || publicAddresses.length === 0) {
          callback(new Error('onebot: image URL resolves to a non-public address'), [])
          return
        }
        if (options.all) callback(null, publicAddresses)
        else callback(null, publicAddresses[0].address, publicAddresses[0].family)
      } catch (error) {
        callback(error as Error, [])
      }
    }
  }
})

function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const value = address.split('.').reduce((result, octet) => result * 256 + Number(octet), 0)
    const inRange = (base: number, bits: number): boolean => {
      const size = 2 ** (32 - bits)
      return value >= base && value < base + size
    }
    return ![
      [0x00000000, 8],
      [0x0a000000, 8],
      [0x64400000, 10],
      [0x7f000000, 8],
      [0xa9fe0000, 16],
      [0xac100000, 12],
      [0xc0000000, 24],
      [0xc0000200, 24],
      [0xc0586300, 24],
      [0xc0a80000, 16],
      [0xc6120000, 15],
      [0xc6336400, 24],
      [0xcb007100, 24],
      [0xe0000000, 4]
    ].some(([base, bits]) => inRange(base, bits))
  }
  const normalized = address.toLowerCase()
  if (normalized === '::' || normalized === '::1') return false
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)
  if (mapped !== null) return isPublicAddress(mapped[1])
  const first = Number.parseInt(normalized.split(':', 1)[0] || '0', 16)
  return (
    (first & 0xfe00) !== 0xfc00 &&
    (first & 0xffc0) !== 0xfe80 &&
    (first & 0xffc0) !== 0xfec0 &&
    (first & 0xff00) !== 0xff00 &&
    !normalized.startsWith('2001:db8:')
  )
}

async function publicImageUrl(source: string): Promise<URL> {
  const url = new URL(source)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('onebot: image URL must use http or https')
  }
  if (url.username !== '' || url.password !== '')
    throw new Error('onebot: image URL must not contain credentials')
  if (isIP(url.hostname) !== 0 && !isPublicAddress(url.hostname)) {
    throw new Error('onebot: image URL must use a public address')
  }
  return url
}

function mediaType(value: string | null): ImageMediaType {
  const type = value?.split(';', 1)[0]?.trim().toLowerCase()
  if (type !== undefined && IMAGE_MEDIA_TYPES.has(type as ImageMediaType)) {
    return type as ImageMediaType
  }
  throw new Error(`onebot: unsupported image media type ${type ?? '(missing)'}`)
}

function boundedBase64(value: string, maxBytes: number): Uint8Array {
  const compact = value.replace(/\s/g, '')
  if (compact.length > Math.ceil(maxBytes / 3) * 4 + 4) {
    throw new Error(`onebot: image exceeds ${maxBytes} bytes`)
  }
  const data = Buffer.from(compact, 'base64')
  if (data.byteLength > maxBytes) throw new Error(`onebot: image exceeds ${maxBytes} bytes`)
  return data
}

function dataImage(source: string, maxBytes: number): SaveImageAttachment {
  const match = /^data:([^;,]+);base64,(.*)$/is.exec(source)
  if (match === null) throw new Error('onebot: image data source must be base64 encoded')
  return { data: boundedBase64(match[2], maxBytes), mediaType: mediaType(match[1]) }
}

async function httpImage(
  source: string,
  maxBytes: number,
  timeoutMs: number
): Promise<SaveImageAttachment> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let url = await publicImageUrl(source)
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await fetch(url, {
        dispatcher: PUBLIC_IMAGE_AGENT,
        redirect: 'manual',
        signal: controller.signal
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (location === null) throw new Error('onebot: image redirect has no location')
        url = await publicImageUrl(new URL(location, url).href)
        continue
      }
      if (!response.ok) throw new Error(`onebot: image download failed (${response.status})`)
      const declaredLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new Error(`onebot: image exceeds ${maxBytes} bytes`)
      }
      const type = mediaType(response.headers.get('content-type'))
      if (response.body === null) throw new Error('onebot: image response has no body')
      const chunks: Uint8Array[] = []
      let length = 0
      for await (const chunk of response.body) {
        length += chunk.byteLength
        if (length > maxBytes) throw new Error(`onebot: image exceeds ${maxBytes} bytes`)
        chunks.push(chunk)
      }
      const data = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) {
        data.set(chunk, offset)
        offset += chunk.byteLength
      }
      return { data, mediaType: type }
    }
    throw new Error(`onebot: image exceeded ${MAX_REDIRECTS} redirects`)
  } finally {
    clearTimeout(timer)
  }
}

export async function saveIncomingImages(
  ctx: Context,
  sources: readonly string[],
  requestTimeout: number
): Promise<
  Array<{ type: 'image'; attachment: Awaited<ReturnType<Context['attachments']['saveImage']>> }>
> {
  const limits = ctx.attachments.imageLimits
  if (sources.length > limits.maxImagesPerMessage) {
    throw new Error(`onebot: message exceeds ${limits.maxImagesPerMessage} images`)
  }
  const inputs: SaveImageAttachment[] = []
  let total = 0
  for (const source of sources) {
    const input = source.startsWith('data:')
      ? dataImage(source, limits.maxImageBytes)
      : source.startsWith('base64://')
        ? (() => {
            throw new Error('onebot: bare base64 image requires a declared media type')
          })()
        : await httpImage(source, limits.maxImageBytes, requestTimeout)
    total += input.data.byteLength
    if (total > limits.maxMessageImageBytes) {
      throw new Error(`onebot: message images exceed ${limits.maxMessageImageBytes} bytes`)
    }
    inputs.push(input)
  }
  await Promise.all(inputs.map((input) => ctx.attachments.validateImage(input)))
  return Promise.all(
    inputs.map(async (input) => ({
      type: 'image' as const,
      attachment: await ctx.attachments.saveImage(input)
    }))
  )
}
