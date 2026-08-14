type ClientRequire = (id: string) => any
type FieldKind = 'boolean' | 'integer' | 'text'
type FieldSpec = readonly [path: string, kind: FieldKind]
type DraftValue = string | boolean
type Draft = Record<string, DraftValue>
type OneBotConfig = {
  url: string
  accessTokenRef: string
  reconnectInterval: number
  respondToPrivate: boolean
  respondToGroup: boolean
  groupMentionOnly: boolean
}

interface ClientModuleWindow extends Window {
  __ModuleLoader__: {
    load(module: {
      id: string
      factory: (require: ClientRequire) => { inject: string[]; apply(ctx: any): void }
    }): void
  }
}

;(window as unknown as ClientModuleWindow).__ModuleLoader__.load({
  id: 'dsh-onebot',
  factory: (require: ClientRequire) => {
    const React = require('react')
    const { jsx, jsxs } = require('react/jsx-runtime')
    const NS = 'onebot.settings'
    const CONFIG_ENDPOINT = 'onebotConfig'
    const zh = {
      title: 'OneBot', description: '配置 OneBot v11 正向 WebSocket 连接与消息回复范围。',
      expand: '展开设置', collapse: '收起设置', loading: '正在加载设置…', retry: '重试',
      save: '保存', saving: '保存中…', discard: '放弃修改',
      unavailable: '无法加载 OneBot 设置，请检查连接后重试。', readOnly: '本部署的设置为只读。',
      saveFailed: '设置保存失败，请检查字段后重试。', invalid: '请输入有效值。',
      url: 'WebSocket 地址', urlHint: 'OneBot v11 正向 WebSocket 地址，例如 ws://127.0.0.1:3001。',
      accessTokenRef: '访问令牌凭据引用名', accessTokenRefHint: '仅填写 DSH 凭据引用名；令牌不会在此显示或传输。',
      reconnectInterval: '重连间隔（毫秒）', reconnectIntervalHint: '连接断开后的等待时间，必须为不小于 0 的整数。',
      respondToPrivate: '回复私聊消息', respondToPrivateHint: '接收私聊消息并将最终助手消息回复给发送者。',
      respondToGroup: '回复群聊消息', respondToGroupHint: '接收群聊消息并将最终助手消息回复到群聊。',
      groupMentionOnly: '群聊仅响应提及', groupMentionOnlyHint: '仅处理包含当前 OneBot 账号 CQ at 的群聊消息。'
    }
    const en = {
      title: 'OneBot', description: 'Configure the OneBot v11 forward WebSocket connection and reply scope.',
      expand: 'Show settings', collapse: 'Hide settings', loading: 'Loading settings…', retry: 'Retry',
      save: 'Save', saving: 'Saving…', discard: 'Discard',
      unavailable: 'OneBot settings could not be loaded. Check the connection and retry.',
      readOnly: 'This deployment stores settings read-only.',
      saveFailed: 'The settings could not be saved. Check the fields and retry.', invalid: 'Enter a valid value.',
      url: 'WebSocket URL', urlHint: 'The OneBot v11 forward WebSocket URL, for example ws://127.0.0.1:3001.',
      accessTokenRef: 'Access token credential reference',
      accessTokenRefHint: 'Enter only the DSH credential reference name; the token is never shown or sent here.',
      reconnectInterval: 'Reconnect interval (ms)', reconnectIntervalHint: 'Delay after a disconnect. Must be a non-negative integer.',
      respondToPrivate: 'Reply to private messages', respondToPrivateHint: "Receive private messages and reply with the agent's final assistant message.",
      respondToGroup: 'Reply to group messages', respondToGroupHint: "Receive group messages and reply with the agent's final assistant message.",
      groupMentionOnly: 'Require a group mention', groupMentionOnlyHint: 'Only handle group messages containing a CQ at mention for this OneBot account.'
    }
    const specs: FieldSpec[] = [
      ['url', 'text'], ['accessTokenRef', 'text'], ['reconnectInterval', 'integer'],
      ['respondToPrivate', 'boolean'], ['respondToGroup', 'boolean'], ['groupMentionOnly', 'boolean']
    ]
    const format = (value: unknown, kind: FieldKind): DraftValue =>
      kind === 'boolean' ? Boolean(value) : typeof value === 'string' || typeof value === 'number' ? String(value) : ''
    const parse = (value: DraftValue, kind: FieldKind): unknown => {
      if (kind === 'boolean') return value
      if (typeof value !== 'string') return undefined
      if (kind === 'text') return value.trim() ? value : undefined
      if (!value.trim()) return undefined
      const number = Number(value)
      return Number.isInteger(number) && number >= 0 ? number : undefined
    }

    function ConfigController(rpc: any) {
      let snapshot: any = { status: 'loading', config: undefined, writable: false }
      const listeners = new Set<() => void>()
      const publish = (next: any) => { snapshot = next; for (const listener of [...listeners]) listener() }
      const load = async () => {
        publish({ ...snapshot, status: 'loading' })
        try {
          const result = await rpc.call('/api', `${CONFIG_ENDPOINT}/get`, { args: {} })
          if (!result.ok) throw new Error(result.error.message)
          publish({ status: 'ready', config: result.value.config, writable: result.value.writable === true })
        } catch { publish({ ...snapshot, status: 'unavailable', writable: false }) }
      }
      const save = async (patch: Partial<OneBotConfig>) => {
        const result = await rpc.call('/api', `${CONFIG_ENDPOINT}/set`, { args: { patch } })
        if (!result.ok) throw new Error(result.error.message)
        publish({ status: 'ready', config: result.value.config, writable: result.value.writable === true })
      }
      void load()
      return { getSnapshot: () => snapshot, subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) }, load, save }
    }

    function Card({ t, scope }: { t: (key: string) => string; scope: any }) {
      const snapshot = React.useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getSnapshot)
      const [open, setOpen] = React.useState(false)
      const [draft, setDraft] = React.useState({}) as [Draft, (value: any) => void]
      const [saving, setSaving] = React.useState(false)
      const [failed, setFailed] = React.useState(false)
      const dirty = Object.keys(draft).length > 0
      const invalid = specs.some(([path, kind]) => Object.hasOwn(draft, path) && parse(draft[path], kind) === undefined)
      const edit = (path: string, value: DraftValue) => { setFailed(false); setDraft((old: Draft) => ({ ...old, [path]: value })) }
      const save = async () => {
        if (!dirty || invalid) return
        setSaving(true); setFailed(false)
        try {
          const patch: Partial<OneBotConfig> = {}
          for (const [path, kind] of specs) if (Object.hasOwn(draft, path)) (patch as any)[path] = parse(draft[path], kind)
          await scope.save(patch); setDraft({})
        } catch { setFailed(true) } finally { setSaving(false) }
      }
      return jsxs('section', { style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2)', overflow: 'hidden' }, children: [
        jsxs('button', { type: 'button', onClick: () => setOpen(!open), style: { width: '100%', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 16, display: 'flex', alignItems: 'center', textAlign: 'left', gap: 12 }, children: [
          jsxs('span', { style: { flex: 1 }, children: [jsx('strong', { style: { display: 'block', fontSize: 15 }, children: t('title') }), jsx('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 13 }, children: t('description') })] }),
          dirty ? jsx('span', { style: { color: 'var(--dsw-alias-brand-primary)', fontSize: 12 }, children: '●' }) : null,
          jsx('span', { 'aria-label': open ? t('collapse') : t('expand'), children: open ? '⌃' : '⌄' })
        ] }),
        open ? jsxs('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l2)', padding: '4px 16px 16px' }, children: [
          snapshot.status === 'loading' ? jsx('p', { children: t('loading') }) : null,
          snapshot.status === 'unavailable' ? jsxs('div', { children: [jsx('p', { children: t('unavailable') }), jsx('button', { type: 'button', onClick: scope.load, children: t('retry') })] }) : null,
          snapshot.status === 'ready' ? specs.map(([path, kind]) => {
            const value = Object.hasOwn(draft, path) ? draft[path] : format(snapshot.config[path], kind)
            const bad = Object.hasOwn(draft, path) && parse(draft[path], kind) === undefined
            return jsxs('label', { style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' }, children: [
              jsx('strong', { style: { fontSize: 13 }, children: t(path) }),
              kind === 'boolean' ? jsx('input', { type: 'checkbox', checked: Boolean(value), disabled: !snapshot.writable, onChange: (event: { target: { checked: boolean } }) => edit(path, event.target.checked) }) :
                jsx('input', { type: kind === 'integer' ? 'number' : 'text', min: kind === 'integer' ? 0 : undefined, step: kind === 'integer' ? 1 : undefined, value, disabled: !snapshot.writable, onChange: (event: { target: { value: string } }) => edit(path, event.target.value), style: { height: 34, border: `1px solid ${bad ? 'var(--dsw-alias-label-error)' : 'var(--dsw-alias-border-l2)'}`, borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3)', color: 'inherit', padding: '0 10px' } }),
              jsx('span', { style: { color: bad ? 'var(--dsw-alias-label-error)' : 'var(--dsw-alias-label-tertiary)', fontSize: 12 }, children: bad ? t('invalid') : t(`${path}Hint`) })
            ] }, path)
          }) : null,
          snapshot.status === 'ready' && !snapshot.writable ? jsx('p', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 }, children: t('readOnly') }) : null,
          failed ? jsx('p', { style: { color: 'var(--dsw-alias-label-error)', fontSize: 12 }, children: t('saveFailed') }) : null,
          snapshot.status === 'ready' ? jsxs('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 14 }, children: [
            jsx('button', { type: 'button', disabled: !dirty || saving, onClick: () => { setDraft({}); setFailed(false) }, children: t('discard') }),
            jsx('button', { type: 'button', disabled: !dirty || invalid || saving || !snapshot.writable, onClick: save, children: saving ? t('saving') : t('save') })
          ] }) : null
        ] }) : null
      ] })
    }

    const inject = ['slots', 'locale', 'connection']
    function apply(ctx: any) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'onebot: settings locale')
      const t = ctx.locale.bind(NS)
      const { rpc } = ctx.get('connection')
      const scope = ConfigController(rpc)
      ctx.effect(() => ctx.on('connection/reset', () => void scope.load()), 'onebot: refresh settings after reconnect')
      ctx.slots.inject('settings.plugin.item', function* () {
        yield ctx.slots.register({ name: 'settings.plugin.item', id: 'onebot', order: 30, locale: NS }, () => jsx(Card, { t, scope }))
      })
    }
    return { inject, apply }
  }
})
