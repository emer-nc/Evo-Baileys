import { WA } from './Constants'
import { proto } from '../../WAMessage/WAMessage'

export default class Encoder {
    data: Array<number> = []

    pushByte(value: number) {
        this.data.push(value & 0xff)
    }
    pushInt(value: number, n: number, littleEndian = false) {
        for (let i = 0; i < n; i++) {
            const curShift = littleEndian ? i : n - 1 - i
            this.data.push((value >> (curShift * 8)) & 0xff)
        }
    }
    pushInt20(value: number) {
        this.pushBytes([(value >> 16) & 0x0f, (value >> 8) & 0xff, value & 0xff])
    }
    pushBytes(bytes: Uint8Array | Array<number>) {
        this.data.push.apply(this.data, bytes)
    }
    pushString(str: string) {
        const bytes = Buffer.from (str, 'utf-8')
        this.pushBytes(bytes)
    }
    writeByteLength(length: number) {
        if (length >= 4294967296) {
            throw new Error('string too large to encode: ' + length)
        }
        if (length >= 1 << 20) {
            this.pushByte(WA.Tags.BINARY_32)
            this.pushInt(length, 4) // 32 bit integer
        } else if (length >= 256) {
            this.pushByte(WA.Tags.BINARY_20)
            this.pushInt20(length)
        } else {
            this.pushByte(WA.Tags.BINARY_8)
            this.pushByte(length)
        }
    }
    writeStringRaw(string: string) {
        this.writeByteLength(string.length)
        this.pushString(string)
    }
    writeJid(left: string, right: string) {
        this.pushByte(WA.Tags.JID_PAIR)
        left && left.length > 0 ? this.writeString(left) : this.writeToken(WA.Tags.LIST_EMPTY)
        this.writeString(right)
    }
    writeToken(token: number) {
        if (token < 245) {
            this.pushByte(token)
        } else if (token <= 500) {
            throw new Error('invalid token')
        }
    }
    writeString(token: string, i: boolean = null) {
        if (token === 'c.us') {
            token = 's.whatsapp.net'
        }

        const tokenIndex = WA.SingleByteTokens.indexOf(token)
        if (!i && token === 's.whatsapp.net') {
            this.writeToken(tokenIndex)
        } else if (tokenIndex >= 0) {
            if (tokenIndex < WA.Tags.SINGLE_BYTE_MAX) {
                this.writeToken(tokenIndex)
            } else {
                const overflow = tokenIndex - WA.Tags.SINGLE_BYTE_MAX
                const dictionaryIndex = overflow >> 8
                if (dictionaryIndex < 0 || dictionaryIndex > 3) {
                    throw new Error('double byte dict token out of range: ' + token + ', ' + tokenIndex)
                }
                this.writeToken(WA.Tags.DICTIONARY_0 + dictionaryIndex)
                this.writeToken(overflow % 256)
            }
        } else if (token) {
            const jidSepIndex = token.indexOf('@')
            if (jidSepIndex <= 0) {
                this.writeStringRaw(token)
            } else {
                this.writeJid(token.slice(0, jidSepIndex), token.slice(jidSepIndex + 1, token.length))
            }
        }
    }
    writeAttributes(attrs: Record<string, string> | string, keys: string[]) {
        if (!attrs) {
            return
        }
        keys.forEach((key) => {
            this.writeString(key)
            this.writeString(attrs[key])
        })
    }
    writeListStart(listSize: number) {
        if (listSize === 0) {
            this.pushByte(WA.Tags.LIST_EMPTY)
        } else if (listSize < 256) {
            this.pushBytes([WA.Tags.LIST_8, listSize])
        } else {
            this.pushBytes([WA.Tags.LIST_16, listSize])
        }
    }
    writeChildren(children: string | Array<WA.Node> | Object) {
        if (!children) {
            return
        }

        if (typeof children === 'string') {
            this.writeString(children, true)
        } else if (Array.isArray(children)) {
            this.writeListStart(children.length)
            children.forEach((c) => {
                if (c) this.writeNode(c)
            })
        } else if (typeof children === 'object') {
            const buffer = WA.Message.encode(children as proto.WebMessageInfo).finish()
            this.writeByteLength(buffer.length)
            this.pushBytes(buffer)
        } else {
            throw new Error('invalid children: ' + children + ' (' + typeof children + ')')
        }
    }
    getValidKeys(obj: Object) {
        return obj ? Object.keys(obj).filter((key) => obj[key] !== null && obj[key] !== undefined) : []
    }
    writeNode(node: WA.Node) {
        if (!node) {
            return
        } else if (node.length !== 3) {
            throw new Error('invalid node given: ' + node)
        }
        const validAttributes = this.getValidKeys(node[1])

        this.writeListStart(2 * validAttributes.length + 1 + (node[2] ? 1 : 0))
        this.writeString(node[0])
        this.writeAttributes(node[1], validAttributes)
        this.writeChildren(node[2])
    }
    write(data) {
        this.data = []
        this.writeNode(data)

        return Buffer.from(this.data)
    }
}