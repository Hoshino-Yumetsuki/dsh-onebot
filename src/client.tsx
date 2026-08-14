type ClientRequire = (id: string) => any
type Kind = 'boolean' | 'integer' | 'text' | 'textarea' | 'transport' | 'accessMode'
type Spec = readonly [key: string, kind: Kind]
type Draft = Record<string, string | boolean>
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
    const {
      Button,
      IconCheckOutline16,
      IconChevronDownOutline14,
      Menu
    } = require('@deepseek-ai/dsh-client-ui-primitives')
    const NS = 'onebot.settings'
    const ENDPOINT = '/onebot/api'
    const zh = {
      title: 'OneBot',
      description: '配置 OneBot v11 连接、消息回复与访问范围。',
      expand: '展开设置',
      collapse: '收起设置',
      loading: '正在加载设置…',
      retry: '重试',
      save: '保存',
      saving: '保存中…',
      discard: '放弃修改',
      unavailable: '无法加载 OneBot 设置，请检查连接后重试。',
      readOnly: '本部署的设置为只读。',
      saveFailed: '设置保存失败，请检查字段后重试。',
      invalid: '请输入有效值。',
      transport: '连接模式',
      transportHint: '选择正向 WebSocket、反向 WebSocket 或 HTTP Webhook。',
      transportForwardWs: '正向 WebSocket',
      transportReverseWs: '反向 WebSocket',
      transportHttp: 'HTTP Webhook',
      url: 'WebSocket 地址',
      urlHint: '正向模式连接的 OneBot WebSocket 地址。',
      listenHost: '监听地址',
      listenHostHint: '反向 WebSocket 或 HTTP 模式的监听地址。',
      listenPort: '监听端口',
      listenPortHint: '反向 WebSocket 或 HTTP 服务端口。',
      listenPath: '监听路径',
      listenPathHint: '反向 WebSocket 或 HTTP 请求路径。',
      accessTokenRef: '访问令牌凭据引用名',
      accessTokenRefHint: '仅编辑 DSH 凭据引用名；令牌不会显示或传输到浏览器。',
      webhookSecretRef: 'Webhook 密钥凭据引用名',
      webhookSecretRefHint: '仅编辑 DSH 凭据引用名；密钥不会显示或传输到浏览器。',
      reconnectInterval: '重连间隔（毫秒）',
      reconnectIntervalHint: '正向连接断开后的等待时间。',
      requestTimeout: '请求超时（毫秒）',
      requestTimeoutHint: '等待匹配 OneBot echo 响应的最长时间。',
      heartbeatTimeout: '心跳超时（毫秒）',
      heartbeatTimeoutHint: '超过此时间未收到心跳则认为连接不可用。',
      commandPrefix: '命令前缀',
      commandPrefixHint: '移除此消息前缀后再投递给 DSH agent；留空表示不要求前缀。',
      respondToPrivate: '回复私聊消息',
      respondToPrivateHint: '将私聊交给 DSH agent，并回复 tools 驱动运行的最终助手消息。',
      respondToGroup: '回复群聊消息',
      respondToGroupHint: '将群聊交给 DSH agent，并回复 tools 驱动运行的最终助手消息。',
      groupMentionOnly: '群聊仅响应提及',
      groupMentionOnlyHint: '仅处理包含当前 OneBot 账号 CQ at 的群聊消息。',
      userAccessMode: '用户访问模式',
      userAccessModeHint: '禁用限制、仅允许名单或拦截名单。',
      userIds: '用户 ID 列表',
      userIdsHint: '每行一个用户 ID；保存时去除空白和重复项。',
      groupAccessMode: '群聊访问模式',
      groupAccessModeHint: '禁用限制、仅允许名单或拦截名单。',
      groupIds: '群聊 ID 列表',
      groupIdsHint: '每行一个群聊 ID；保存时去除空白和重复项。',
      accessDisabled: '不限制',
      accessAllowlist: '仅允许名单',
      accessBlocklist: '拦截名单'
    }
    const en = {
      title: 'OneBot',
      description: 'Configure the OneBot v11 connection, replies, and access scope.',
      expand: 'Show settings',
      collapse: 'Hide settings',
      loading: 'Loading settings…',
      retry: 'Retry',
      save: 'Save',
      saving: 'Saving…',
      discard: 'Discard',
      unavailable: 'OneBot settings could not be loaded. Check the connection and retry.',
      readOnly: 'This deployment stores settings read-only.',
      saveFailed: 'The settings could not be saved. Check the fields and retry.',
      invalid: 'Enter a valid value.',
      transport: 'Connection mode',
      transportHint: 'Choose forward WebSocket, reverse WebSocket, or HTTP webhook.',
      transportForwardWs: 'Forward WebSocket',
      transportReverseWs: 'Reverse WebSocket',
      transportHttp: 'HTTP webhook',
      url: 'WebSocket URL',
      urlHint: 'OneBot WebSocket URL used in forward mode.',
      listenHost: 'Listen host',
      listenHostHint: 'Listen address for reverse WebSocket or HTTP mode.',
      listenPort: 'Listen port',
      listenPortHint: 'Server port for reverse WebSocket or HTTP mode.',
      listenPath: 'Listen path',
      listenPathHint: 'Request path for reverse WebSocket or HTTP mode.',
      accessTokenRef: 'Access token credential reference',
      accessTokenRefHint:
        'Edit only the DSH credential reference name; the token is never shown or sent to the browser.',
      webhookSecretRef: 'Webhook secret credential reference',
      webhookSecretRefHint:
        'Edit only the DSH credential reference name; the secret is never shown or sent to the browser.',
      reconnectInterval: 'Reconnect interval (ms)',
      reconnectIntervalHint: 'Delay after a forward connection disconnects.',
      requestTimeout: 'Request timeout (ms)',
      requestTimeoutHint: 'Maximum wait for a matching OneBot echo response.',
      heartbeatTimeout: 'Heartbeat timeout (ms)',
      heartbeatTimeoutHint:
        'Treat the connection as unavailable after this long without a heartbeat.',
      commandPrefix: 'Command prefix',
      commandPrefixHint:
        'Remove this prefix before delivering the message to the DSH agent; blank accepts messages without a prefix.',
      respondToPrivate: 'Reply to private messages',
      respondToPrivateHint:
        'Send private messages to the DSH agent and reply with the final assistant message from its tools-driven run.',
      respondToGroup: 'Reply to group messages',
      respondToGroupHint:
        'Send group messages to the DSH agent and reply with the final assistant message from its tools-driven run.',
      groupMentionOnly: 'Require a group mention',
      groupMentionOnlyHint:
        'Only handle group messages containing a CQ at mention for this OneBot account.',
      userAccessMode: 'User access mode',
      userAccessModeHint: 'Disable filtering, allow only listed users, or block listed users.',
      userIds: 'User IDs',
      userIdsHint: 'One user ID per line; whitespace and duplicates are removed on save.',
      groupAccessMode: 'Group access mode',
      groupAccessModeHint: 'Disable filtering, allow only listed groups, or block listed groups.',
      groupIds: 'Group IDs',
      groupIdsHint: 'One group ID per line; whitespace and duplicates are removed on save.',
      accessDisabled: 'No filtering',
      accessAllowlist: 'Allowlist only',
      accessBlocklist: 'Blocklist'
    }
    const specs: Spec[] = [
      ['transport', 'transport'],
      ['url', 'text'],
      ['listenHost', 'text'],
      ['listenPort', 'integer'],
      ['listenPath', 'text'],
      ['accessTokenRef', 'text'],
      ['webhookSecretRef', 'text'],
      ['reconnectInterval', 'integer'],
      ['requestTimeout', 'integer'],
      ['heartbeatTimeout', 'integer'],
      ['commandPrefix', 'text'],
      ['respondToPrivate', 'boolean'],
      ['respondToGroup', 'boolean'],
      ['groupMentionOnly', 'boolean'],
      ['userAccessMode', 'accessMode'],
      ['userIds', 'textarea'],
      ['groupAccessMode', 'accessMode'],
      ['groupIds', 'textarea']
    ]
    const format = (value: any, kind: Kind) =>
      kind === 'boolean'
        ? Boolean(value)
        : kind === 'textarea'
          ? Array.isArray(value)
            ? value.join('\n')
            : ''
          : value == null
            ? ''
            : String(value)
    const parse = (value: string | boolean, kind: Kind): any => {
      if (kind === 'boolean') return value
      if (typeof value !== 'string') return undefined
      if (kind === 'textarea')
        return [
          ...new Set(
            value
              .split(/\r?\n/)
              .map((item) => item.trim())
              .filter(Boolean)
          )
        ]
      if (kind === 'transport')
        return ['forward-ws', 'reverse-ws', 'http'].includes(value) ? value : undefined
      if (kind === 'accessMode')
        return ['disabled', 'allowlist', 'blocklist'].includes(value) ? value : undefined
      if (kind === 'text') return value
      const number = Number(value)
      return value.trim() && Number.isSafeInteger(number) && number >= 0 ? number : undefined
    }
    function controller() {
      let state: any = { status: 'loading', config: {}, writable: false }
      const listeners = new Set<() => void>()
      const publish = (next: any) => {
        state = next
        for (const listener of listeners) listener()
      }
      const request = async (method: 'get' | 'set', body: unknown) => {
        const response = await fetch(`${ENDPOINT}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        })
        const result = await response.json()
        if (!response.ok || !result.ok) throw new Error()
        return result.value
      }
      const load = async () => {
        publish({ ...state, status: 'loading' })
        try {
          const value = await request('get', {})
          publish({ status: 'ready', config: value.config, writable: value.writable === true })
        } catch {
          publish({ ...state, status: 'unavailable', writable: false })
        }
      }
      const save = async (patch: any) => {
        const value = await request('set', { patch })
        publish({ status: 'ready', config: value.config, writable: value.writable === true })
      }
      void load()
      return {
        getSnapshot: () => state,
        subscribe(fn: () => void) {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
        load,
        save
      }
    }
    const inputStyle = (bad: boolean) => ({
      boxSizing: 'border-box' as const,
      width: '100%',
      minHeight: 34,
      border: `1px solid ${bad ? 'var(--dsw-alias-label-error)' : 'var(--dsw-alias-border-l2)'}`,
      borderRadius: 8,
      background: 'var(--dsw-alias-bg-layer-3)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: 13,
      lineHeight: 1.5,
      padding: '7px 12px'
    })
    function BooleanControl({ value, disabled, label, onChange }: any) {
      return (
        <button
          type="button"
          role="checkbox"
          aria-checked={Boolean(value)}
          aria-label={label}
          disabled={disabled}
          onClick={() => onChange(!value)}
          style={{
            appearance: 'none',
            width: 18,
            height: 18,
            flex: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            border: '1px solid var(--dsw-alias-border-l2)',
            borderRadius: 5,
            background: value ? 'var(--dsw-alias-button-primary-fill)' : 'transparent',
            color: 'var(--dsw-alias-label-primary-foreground)',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.4 : 1
          }}
        >
          {value ? <IconCheckOutline16 size={14} /> : null}
        </button>
      )
    }
    function EnumMenu({ value, disabled, options, t, onChange }: any) {
      const [open, setOpen] = React.useState(false)
      return (
        <Menu
          open={open}
          anchor={
            <Button
              variant="toolbar"
              disabled={disabled}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {t(options.find(([id]: readonly string[]) => id === value)?.[1])}
              <span
                style={{
                  flex: 'none',
                  display: 'inline-flex',
                  transform: open ? 'rotate(180deg)' : 'none',
                  transition: 'transform .16s'
                }}
              >
                <IconChevronDownOutline14 />
              </span>
            </Button>
          }
          items={options.map(([id, label]: readonly string[]) => ({ id, label: t(label) }))}
          selectedId={value}
          onSelect={(id: string) => {
            onChange(id)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
          align="start"
          portal
        />
      )
    }
    function Card({ t, scope }: any) {
      const state = React.useSyncExternalStore(
        scope.subscribe,
        scope.getSnapshot,
        scope.getSnapshot
      )
      const [open, setOpen] = React.useState(false),
        [draft, setDraft] = React.useState({}) as [Draft, (value: any) => void],
        [saving, setSaving] = React.useState(false),
        [failed, setFailed] = React.useState(false)
      const dirty = Object.keys(draft).length > 0
      const invalid = specs.some(
        ([key, kind]) => Object.hasOwn(draft, key) && parse(draft[key], kind) === undefined
      )
      const edit = (key: string, value: string | boolean) => {
        setFailed(false)
        setDraft((old: Draft) => ({ ...old, [key]: value }))
      }
      const save = async () => {
        if (!dirty || invalid) return
        setSaving(true)
        setFailed(false)
        try {
          const patch: any = {}
          for (const [key, kind] of specs)
            if (Object.hasOwn(draft, key)) patch[key] = parse(draft[key], kind)
          await scope.save(patch)
          setDraft({})
        } catch {
          setFailed(true)
        } finally {
          setSaving(false)
        }
      }
      const options = (kind: Kind) =>
        kind === 'transport'
          ? [
              ['forward-ws', 'transportForwardWs'],
              ['reverse-ws', 'transportReverseWs'],
              ['http', 'transportHttp']
            ]
          : [
              ['disabled', 'accessDisabled'],
              ['allowlist', 'accessAllowlist'],
              ['blocklist', 'accessBlocklist']
            ]
      const cardStyle = {
        listStyle: 'none',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 12,
        background: open ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-3)',
        transition: 'border-color .16s, background .16s'
      }
      return (
        <li style={cardStyle}>
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
            onClick={() => setOpen(!open)}
            style={{
              width: '100%',
              appearance: 'none',
              border: 0,
              background: 'none',
              font: 'inherit',
              color: 'inherit',
              textAlign: 'left',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 16px',
              borderRadius: 12
            }}
          >
            <span
              style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}
            >
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  lineHeight: 1.4,
                  color: 'var(--dsw-alias-label-primary)'
                }}
              >
                {t('title')}
              </span>
              <span
                style={{
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: 'var(--dsw-alias-label-tertiary)'
                }}
              >
                {t('description')}
              </span>
            </span>
            {dirty ? (
              <span
                style={{
                  borderRadius: 999,
                  padding: '1px 8px',
                  fontSize: 11,
                  lineHeight: '17px',
                  background: 'var(--dsw-alias-bg-module-platform)',
                  color: 'var(--dsw-alias-label-secondary)'
                }}
              >
                ●
              </span>
            ) : null}
            <span
              style={{
                color: 'var(--dsw-alias-label-tertiary)',
                transform: open ? 'rotate(180deg)' : 'none',
                transition: 'transform .16s'
              }}
            >
              ⌄
            </span>
          </button>
          {open ? (
            <div
              style={{
                borderTop: '1px solid var(--dsw-alias-border-l2)',
                margin: '0 16px',
                paddingBottom: 8
              }}
            >
              {state.status === 'loading' ? (
                <p style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>
                  {t('loading')}
                </p>
              ) : null}
              {state.status === 'unavailable' ? (
                <div>
                  <p style={{ fontSize: 12, color: 'var(--dsw-alias-state-warn-label)' }}>
                    {t('unavailable')}
                  </p>
                  <Button variant="outline" onClick={state.load}>
                    {t('retry')}
                  </Button>
                </div>
              ) : null}
              {state.status === 'ready'
                ? specs.map(([key, kind], index) => {
                    const value = Object.hasOwn(draft, key)
                        ? draft[key]
                        : format(state.config[key], kind),
                      bad = Object.hasOwn(draft, key) && parse(draft[key], kind) === undefined
                    const title = t(key)
                    const control =
                      kind === 'boolean' ? (
                        <BooleanControl
                          value={value}
                          disabled={!state.writable}
                          label={title}
                          onChange={(next: boolean) => edit(key, next)}
                        />
                      ) : kind === 'textarea' ? (
                        <textarea
                          rows={4}
                          value={value as string}
                          disabled={!state.writable}
                          onChange={(e) => edit(key, e.target.value)}
                          style={inputStyle(bad)}
                        />
                      ) : kind === 'transport' || kind === 'accessMode' ? (
                        <EnumMenu
                          value={value}
                          disabled={!state.writable}
                          options={options(kind)}
                          t={t}
                          onChange={(next: string) => edit(key, next)}
                        />
                      ) : (
                        <input
                          type={kind === 'integer' ? 'number' : 'text'}
                          min={kind === 'integer' ? 0 : undefined}
                          step={kind === 'integer' ? 1 : undefined}
                          value={value as string}
                          disabled={!state.writable}
                          onChange={(e) => edit(key, e.target.value)}
                          style={inputStyle(bad)}
                        />
                      )
                    const text = (
                      <span
                        style={{
                          flex: kind === 'boolean' ? 1 : undefined,
                          minWidth: 0,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            lineHeight: 1.5,
                            color: 'var(--dsw-alias-label-primary)'
                          }}
                        >
                          {title}
                        </span>
                        {kind === 'boolean' ? (
                          <span
                            style={{
                              color: 'var(--dsw-alias-label-tertiary)',
                              fontSize: 12,
                              lineHeight: 1.5
                            }}
                          >
                            {t(`${key}Hint`)}
                          </span>
                        ) : null}
                      </span>
                    )
                    return kind === 'boolean' ? (
                      <div
                        key={key}
                        style={{
                          display: 'flex',
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 16,
                          padding: '12px 0',
                          borderTop: index ? '1px solid var(--dsw-alias-border-l2)' : 'none'
                        }}
                      >
                        {text}
                        {control}
                      </div>
                    ) : (
                      <label
                        key={key}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          padding: '12px 0',
                          borderTop: index ? '1px solid var(--dsw-alias-border-l2)' : 'none'
                        }}
                      >
                        {text}
                        {control}
                        <span
                          style={{
                            margin: 0,
                            color: bad
                              ? 'var(--dsw-alias-label-error)'
                              : 'var(--dsw-alias-label-tertiary)',
                            fontSize: 12,
                            lineHeight: 1.5
                          }}
                        >
                          {bad ? t('invalid') : t(`${key}Hint`)}
                        </span>
                      </label>
                    )
                  })
                : null}
              {state.status === 'ready' && !state.writable ? (
                <p style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>
                  {t('readOnly')}
                </p>
              ) : null}
              {state.status === 'ready' ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 8,
                    padding: '12px 0 4px',
                    borderTop: '1px solid var(--dsw-alias-border-l2)'
                  }}
                >
                  {failed ? (
                    <p
                      style={{
                        flex: 1,
                        margin: 0,
                        fontSize: 12,
                        color: 'var(--dsw-alias-label-error)'
                      }}
                    >
                      {t('saveFailed')}
                    </p>
                  ) : null}
                  <Button
                    variant="outline"
                    disabled={!dirty || saving}
                    onClick={() => {
                      setDraft({})
                      setFailed(false)
                    }}
                  >
                    {t('discard')}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!dirty || invalid || saving || !state.writable}
                    onClick={save}
                  >
                    {saving ? t('saving') : t('save')}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </li>
      )
    }
    const inject = ['slots', 'locale', 'connection']
    function apply(ctx: any) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'onebot: settings locale')
      const t = ctx.locale.bind(NS),
        scope = controller()
      ctx.effect(
        () => ctx.on('connection/reset', () => void scope.load()),
        'onebot: refresh settings after reconnect'
      )
      ctx.slots.inject('settings.plugin.item', function* () {
        yield ctx.slots.register(
          { name: 'settings.plugin.item', id: 'onebot', order: 30, locale: NS },
          () => <Card t={t} scope={scope} />
        )
      })
    }
    return { inject, apply }
  }
})
