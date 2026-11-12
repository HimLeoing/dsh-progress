/**
 * dsh-task-progress — Client half.
 *
 * Conversation binding and an independent task progress overlay.
 */
window.__ModuleLoader__.load({
  id: 'dsh-task-progress',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const API = {
      state: '/dsh-task-progress/state',
      preferences:'/dsh-task-progress/preferences',
      probe:'/dsh-task-progress/probe',
      debug:'/dsh-task-progress/debug', update:'/dsh-task-progress/update/apply',
    }
    const POLL_MS = 1200
    const COLLAPSE_KEY = 'dsh-task-progress.panel.collapsed.v2'
    const STYLE_ID = 'dsh-task-progress'

    /* ------------------------------------------------------------------ */
    /* copy                                                                */
    /* ------------------------------------------------------------------ */

    const TEXT = {
      zh: {
        updating: '更新中…',
        progress: '任务进度',
        project: '项目',
        current: '当前',
        command: '命令',
        team: '智能体团队',
        todos: '任务清单',
        agents: '子代理',
        estimate: '估算',
        noSession: '没有活动会话',
        noPlan: '等待任务计划',
        remaining: '剩余',
        remainingAbout: '剩余约',
        used: '用时',
        thinking: '思考中',
        calculating: '计算中',
        elapsed: '已',
        done: '完成',
        thisTurn: '本轮',
        lastKnown: '上次记录',
        interrupted: '中断',
        disconnected: '连接中断，保留上次进度',
        steps: '步',
        target: '目标',
        collapsed: '展开',
        expanded: '收起',
      },
      en: {
        updating: 'Updating…',
        progress: 'Task progress',
        project: 'Project',
        current: 'Current',
        command: 'Command',
        team: 'Agent team',
        todos: 'Task list',
        agents: 'Subagents',
        estimate: 'estimate',
        noSession: 'No active session',
        noPlan: 'Waiting for a plan',
        remaining: 'left',
        remainingAbout: 'about',
        used: 'used',
        thinking: 'Thinking…',
        calculating: 'calculating…',
        elapsed: 'elapsed',
        done: 'done',
        thisTurn: 'this turn',
        lastKnown: 'last known',
        interrupted: 'interrupted',
        disconnected: 'Disconnected; showing last progress',
        steps: 'steps',
        target: 'target',
        collapsed: 'Expand',
        expanded: 'Collapse',
      },
    }

    /* ------------------------------------------------------------------ */
    /* styles                                                              */
    /* ------------------------------------------------------------------ */

    const CSS = [
      /* --- progress card ------------------------------------------------ */
      '.dtp-overlay{position:fixed;top:96px;right:20px;z-index:40;display:flex;justify-content:flex-end;pointer-events:none}',
      '.dtp-card{pointer-events:auto;width:296px;box-sizing:border-box;padding:9px 11px 11px;border-radius:14px;',
      'border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 42%,transparent);',
      'background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 46%,transparent);',
      'backdrop-filter:blur(26px) saturate(1.35);-webkit-backdrop-filter:blur(26px) saturate(1.35);',
      'color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;',
      'box-shadow:0 1px 0 color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent) inset;',
      'transition:width .22s cubic-bezier(.22,1,.36,1),opacity .2s ease}',
      '.dtp-card[data-collapsed="1"]{width:auto;padding:7px 8px}',
      '.dtp-card[data-idle="1"]{opacity:.72}',
      '.dtp-head{display:flex;align-items:center;gap:8px}',
      '.dtp-card[data-collapsed="1"] .dtp-head{gap:6px}',
      '.dtp-headpct{font-size:12px;font-variant-numeric:tabular-nums;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}',
      '.dtp-title{font-size:12px;font-weight:500;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dtp-grow{flex:1 1 auto;min-width:2px}',
      '.dtp-collapse{appearance:none;-webkit-appearance:none;width:18px;height:18px;padding:0;border:0;border-radius:6px;flex:none;',
      'background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}',
      '.dtp-collapse:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);color:var(--dsw-alias-label-primary)}',
      '.dtp-collapse svg{width:12px;height:12px;display:block;transition:transform .18s ease}',
      '.dtp-ringw{flex:none;display:block;overflow:visible}',
      '.dtp-ring-turn{transform-box:view-box;transform-origin:50% 50%;animation:dtp-turn 1.15s linear infinite}',
      '@keyframes dtp-turn{to{transform:rotate(360deg)}}',
      ".dtp-headpct[data-quiet='1']{color:var(--dsw-alias-label-secondary);font-size:11px}",
      '.dtp-block{margin-top:9px}',
      '.dtp-labelrow{display:flex;align-items:baseline;gap:8px;margin-bottom:5px;min-width:0}',
      '.dtp-k{flex:none;font-size:11px;letter-spacing:.02em;color:var(--dsw-alias-label-secondary)}',
      '.dtp-sub{flex:1 1 auto;min-width:0;font-size:11px;color:var(--dsw-alias-label-secondary);',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dtp-v{flex:none;font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}',
      '.dtp-bar{position:relative;height:5px;border-radius:999px;overflow:hidden;',
      'background:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent)}',
      '.dtp-bar>span{position:absolute;left:0;top:0;bottom:0;border-radius:999px;',
      'background:var(--dsw-alias-brand-primary);transition:width .5s cubic-bezier(.22,1,.36,1)}',
      '.dtp-bar[data-tone="muted"]>span{background:var(--dsw-alias-state-idle-primary)}',
      '.dtp-bar[data-shimmer="1"]>span{width:36%!important;animation:dtp-slide 1.35s ease-in-out infinite}',
      '@keyframes dtp-slide{0%{transform:translateX(-105%)}100%{transform:translateX(320%)}}',
      '.dtp-card{width:352px;max-width:calc(100vw - 32px);padding:10px 12px 12px;border-radius:15px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 90%,transparent);box-shadow:0 6px 24px color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}',
      '.dtp-card[data-idle="1"]{opacity:1}',
      '.dtp-head{gap:5px;min-height:30px}',
      '.dtp-headpct{font-size:16px;font-weight:600;letter-spacing:-.025em}',
      '.dtp-title{font-size:12px}',
      '.dtp-phase{font-size:10px;max-width:86px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:2px 6px;border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-secondary)}',
      '.dtp-collapse{width:30px;height:30px;border-radius:8px;transition:background-color .15s ease,transform .15s ease}',
      '.dtp-collapse:active{transform:scale(.94)}',
      '.dtp-collapse:focus-visible,.dtp-refresh:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.dtp-collapse svg{width:15px;height:15px}',
      '.dtp-card[data-collapsed="1"]{padding:4px 6px}',
      '.dtp-card[data-collapsed="1"] .dtp-head{min-height:22px;gap:5px}',
      '.dtp-card[data-collapsed="1"] .dtp-headpct{font-size:12px}',
      '.dtp-card[data-collapsed="1"] .dtp-collapse{width:22px;height:22px}',
      '.dtp-total{margin-top:8px}',
      '.dtp-totalrow,.dtp-totalmeta,.dtp-footnote,.dtp-detailmeta{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.dtp-totalrow{margin-bottom:8px}',
      '.dtp-eta{font-size:13px;font-weight:550;font-variant-numeric:tabular-nums}',
      '.dtp-total .dtp-bar{height:6px}',
      '.dtp-totalmeta{margin-top:6px;color:var(--dsw-alias-label-secondary);font-size:10px;font-variant-numeric:tabular-nums}',
      '.dtp-block{margin-top:12px}',
      '.dtp-labelrow{gap:6px}',
      '.dtp-v{font-size:10px}',
      '.dtp-block[data-compact="1"] .dtp-sub{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.5;color:var(--dsw-alias-label-primary)}',
      '.dtp-footnote{margin-top:10px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l2);font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dtp-notice{margin-top:8px;padding:6px 8px;border-radius:7px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);font-size:11px}',
      '.dtp-details{margin-top:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2);max-height:min(400px,calc(100dvh - 290px));overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}',
      '.dtp-details[data-content="0"]{padding-top:0}',
      '.dtp-card[data-collapsed="0"]{width:var(--dtp-expanded-width,352px)}.dtp-card{transition:opacity .2s ease}.dtp-head{cursor:grab;touch-action:none;user-select:none}.dtp-overlay[data-dragging="1"] .dtp-head{cursor:grabbing}.dtp-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:6px}.dtp-head button{cursor:pointer}.dtp-card{max-height:max(80px,calc(100dvh - var(--dtp-top,96px) - 12px))}.dtp-current-summary{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-primary)}.dtp-summary-count{flex:none;font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dtp-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}.dtp-version{text-align:right;color:var(--dsw-alias-label-tertiary);font-size:9px}.dtp-debug{height:196px;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;font-size:10px;margin:4px 0 8px;overflow:hidden;overflow-wrap:anywhere}.dtp-debug>p{font-size:9px;line-height:1.4;margin:0;color:var(--dsw-alias-label-secondary)}.dtp-debug-controls{display:flex;align-items:center;gap:6px;flex:none}.dtp-debug-records{flex:1;min-height:0;overflow-y:scroll;scrollbar-gutter:stable;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-label-tertiary) transparent}.dtp-debug-records::-webkit-scrollbar{width:8px}.dtp-debug-records::-webkit-scrollbar-thumb{background:var(--dsw-alias-label-tertiary);border-radius:5px}.dtp-debug-records::-webkit-scrollbar-track{background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent)}.dtp-debug button,.dtp-debug a{font:inherit;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;padding:5px 7px;margin-right:6px}.dtp-debug pre{white-space:pre-wrap;overflow-x:auto;font:10px/1.5 monospace;border:1px solid var(--dsw-alias-border-l2);padding:6px;border-radius:5px}.dtp-debug summary{cursor:pointer;padding:5px 0}.dtp-update{color:var(--dsw-alias-brand-primary)}',
      '.dtp-diag-top,.dtp-trend-label,.dtp-probe-state,.dtp-diag-setting{display:flex;align-items:center;gap:7px;justify-content:space-between;font-size:10px;color:var(--dsw-alias-label-secondary)}.dtp-diag-top{margin-bottom:9px}.dtp-status-pill{padding:2px 5px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent)}.dtp-status-pill[data-active="1"]{color:var(--dsw-alias-brand-primary)}.dtp-probe-effort{font-variant:small-caps}.dtp-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.dtp-metric{display:flex;flex-direction:column;gap:3px;padding:7px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;min-width:0}.dtp-metric strong{font-size:14px;font-weight:550;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}.dtp-metric:last-child strong{font-size:12px}.dtp-metric span{font-size:9px;color:var(--dsw-alias-label-secondary)}.dtp-trend{margin:10px 0 6px}.dtp-sparkline{width:100%;height:64px;display:block;color:var(--dsw-alias-label-primary)}.dtp-trend-label{font-size:9px}.dtp-probe-state{justify-content:flex-start;padding:7px 0}.dtp-latency{margin-left:auto;font-variant-numeric:tabular-nums}.dtp-observations{font-size:9px;color:var(--dsw-alias-label-secondary);display:grid;gap:5px;margin-bottom:8px}.dtp-observations>div{display:grid;grid-template-columns:1fr auto auto;gap:10px}.dtp-observations[data-running="0"]>div{grid-template-columns:1fr auto}.dtp-diag-empty{padding:8px 0;font-size:10px;color:var(--dsw-alias-label-secondary)}.dtp-diag-setting{padding:9px 0;border-top:1px solid var(--dsw-alias-border-l2)}.dtp-diag-setting select{padding:3px 5px;max-width:150px}.dtp-diag-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:8px}.dtp-diag-actions button{appearance:none;font:inherit;font-size:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:6px 3px;color:var(--dsw-alias-label-primary);background:transparent;cursor:pointer}.dtp-diag-actions button:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent)}.dtp-diag-actions button:disabled{opacity:.4;cursor:default}.dtp-diag-actions button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.dtp-detailmeta{font-size:11px;margin-bottom:7px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dtp-detailmeta strong{font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.dtp-detailheading{font-size:11px;font-weight:550;margin-top:12px;margin-bottom:7px}',
      '.dtp-explain{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.55;margin:6px 0;text-wrap:pretty}',
      '.dtp-plan{list-style:none;margin:0;padding:0;display:grid;gap:8px}',
      '.dtp-plan li{display:flex;align-items:flex-start;gap:7px;min-width:0;font-size:11px}',
      '.dtp-planmark{width:15px;flex:none;text-align:center;font-size:10px;color:var(--dsw-alias-label-secondary)}',
      '.dtp-plantext{overflow-wrap:anywhere;line-height:1.5}',
      '.dtp-plan li[data-state="completed"]{color:var(--dsw-alias-label-secondary)}',
      '.dtp-plan li[data-state="in_progress"] .dtp-planmark{color:var(--dsw-alias-brand-primary)}',
      '.dtp-dependent{flex:none;font-size:9px;color:var(--dsw-alias-label-secondary)}',
      '.dtp-workers{display:grid;grid-template-columns:repeat(auto-fit,minmax(86px,1fr));gap:6px}.dtp-worker{min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:6px 5px;text-align:center}.dtp-workername{font-size:10px;line-height:14px;font-weight:550;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}.dtp-worker-ring{position:relative;display:grid;place-items:center;margin:5px auto 4px;width:38px;height:38px}.dtp-worker-ring>span{position:absolute;font-size:10px;font-variant-numeric:tabular-nums}.dtp-workerstatus{font-size:9px;line-height:12px}.dtp-workerop{margin-top:3px;font-size:9px;line-height:1.3;color:var(--dsw-alias-label-secondary);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere;min-height:0}.dtp-worker .dtp-operationmeta{font-size:9px;line-height:12px;margin-top:3px}.dtp-workers{margin-top:7px}.dtp-worker-open{display:block;width:100%;border:0;background:none;padding:0;color:inherit;font:inherit;text-align:center;cursor:pointer}.dtp-worker-open:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:4px;border-radius:5px}.dtp-worker-nav{display:flex;gap:8px;align-items:center;margin:0 0 8px;font-size:10px}.dtp-worker-nav button{flex-shrink:0;background:none;border:0;color:var(--dsw-alias-brand-primary);padding:2px;cursor:pointer}.dtp-worker-nav span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}@media(max-width:340px){.dtp-workers[data-count]{grid-template-columns:repeat(2,minmax(0,1fr))!important}.dtp-workers[data-count="1"]{grid-template-columns:1fr!important}}',
      '.dtp-child{display:flex;align-items:center;gap:7px;margin-top:7px;min-width:0}',
      '.dtp-dot{width:5px;height:5px;flex:none;border-radius:50%;background:var(--dsw-alias-label-secondary)}',
      '.dtp-dot[data-state="running"]{background:var(--dsw-alias-brand-primary)}',
      '.dtp-card{max-height:max(80px,calc(100dvh - var(--dtp-top,96px) - 12px));overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}',
      '.dtp-operationmeta{font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;margin-top:4px}',
      '.dtp-more{font-size:10px;color:var(--dsw-alias-label-secondary);display:block;margin-top:6px}',
      '.dtp-trend-scroll{max-width:100%;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent}.dtp-trend-scroll .dtp-sparkline{height:76px;max-width:none}.dtp-trend-scroll:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dtp-point-tip{display:none}.dtp-trend-point:hover .dtp-point-tip,.dtp-trend-point:focus-within .dtp-point-tip{display:block}.dtp-trend-point circle:focus{outline:none;stroke:var(--dsw-alias-label-primary);stroke-width:1}',
      '.dtp-point-tooltip{position:fixed;inset:auto;margin:0;box-sizing:border-box;z-index:1000;pointer-events:none;width:max-content;max-width:min(240px,calc(100vw - 16px));padding:7px 9px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:11px;line-height:1.5;box-shadow:0 4px 14px #0002;overflow-wrap:anywhere}.dtp-point-owner{font-weight:550;margin-bottom:3px}',
      '.dtp-history-reference{font-size:9px;color:var(--dsw-alias-label-secondary);opacity:.8;margin:4px 0 6px}',
      '.dtp-ai-toggle{flex:none;appearance:none;font:inherit;font-size:10px;line-height:18px;padding:2px 7px;min-width:36px;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.dtp-ai-toggle[aria-checked="true"]{color:#c9a34b;border-color:#c9a34b}.dtp-ai-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dtp-ai-toggle:disabled{opacity:.5;cursor:default}.dtp-diagnostics select{font:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
      '.dtp-recent-inline{display:flex;align-items:center;gap:4px;flex:1;min-width:0}.dtp-recent-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dtp-recent-state{flex:none;color:var(--dsw-alias-label-secondary)}.dtp-recent-state[data-failed="1"]{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-primary))}.dtp-task-times{display:flex;align-items:center;gap:8px;flex:0 0 auto;white-space:nowrap}.dtp-totalelapsed,.dtp-totalremaining{flex:none;white-space:nowrap}.dtp-head .dtp-phase{min-width:0;flex:0 1 auto}.dtp-headpct,.dtp-title{flex:none}.dtp-head .dtp-grow{min-width:0}',
      '.dtp-refresh{width:100%;appearance:none;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;padding:7px;cursor:pointer;margin-top:10px}',
      '.dtp-refresh:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent)}',
      '.dtp-diagnostics{padding-top:6px}',
      '.dtp-card[data-state="disconnected"] .dtp-bar>span{animation-play-state:paused}',
      '@media(max-width:400px){.dtp-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '@media(max-width:600px){.dtp-overlay{right:10px;top:86px}.dtp-card{max-width:calc(100vw - 20px)}.dtp-details{max-height:calc(100dvh - 310px)}}',
      '@media(prefers-reduced-motion:reduce){.dtp-card,.dtp-bar>span,.dtp-collapse,.dtp-collapse svg{transition:none}.dtp-ring-turn,.dtp-bar[data-shimmer="1"]>span{animation:none}.dtp-bar[data-shimmer="1"]>span{width:100%!important;opacity:.3}}',
    ].join('')

    function injectStyle() {
      if (typeof document === 'undefined') return () => {}
      if (document.querySelector(`style[data-dsh-task-progress="${STYLE_ID}"]`) !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.dshTaskProgress = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        try {
          tag.remove()
        } catch {
          /* already detached */
        }
      }
    }

    /* ------------------------------------------------------------------ */
    /* glyphs                                                              */
    /* ------------------------------------------------------------------ */

    /**
     * A small ring gauge: a muted track plus a brand arc from 12 o'clock.
     * `muted` draws the idle colour (nothing is running); `indeterminate`
     * spins a short arc instead of showing a fraction nobody can compute.
     */
    function Ring({ value, size = 18, indeterminate, muted }) {
      const stroke = 2.4
      const radius = (size - stroke) / 2
      const circumference = 2 * Math.PI * radius
      const center = size / 2
      const clamped = Math.max(0, Math.min(1, typeof value === 'number' && Number.isFinite(value) ? value : 0))
      const color = muted ? 'var(--dsw-alias-state-idle-primary)' : 'var(--dsw-alias-brand-primary)'
      // A dash that equals the circumference leaves a visible seam where the
      // round cap meets its own start, so a finished ring is drawn undashed.
      const complete = !indeterminate && clamped >= 0.999
      const arc = h('circle', {
        cx: center,
        cy: center,
        r: radius,
        fill: 'none',
        stroke: color,
        strokeWidth: stroke,
        strokeLinecap: complete ? 'butt' : 'round',
        ...(complete ? {} : { strokeDasharray: `${(indeterminate ? 0.26 : clamped) * circumference} ${circumference}` }),
        transform: `rotate(-90 ${center} ${center})`,
        style: complete ? undefined : { transition: 'stroke-dasharray .5s cubic-bezier(.22,1,.36,1)' },
      })
      return h(
        'svg',
        { className: 'dtp-ringw', width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': true },
        h('circle', {
          cx: center,
          cy: center,
          r: radius,
          fill: 'none',
          stroke: 'var(--dsw-alias-label-primary)',
          strokeOpacity: 0.16,
          strokeWidth: stroke,
        }),
        indeterminate ? h('g', { className: 'dtp-ring-turn' }, arc) : arc,
      )
    }

    /* ------------------------------------------------------------------ */
    /* formatting                                                          */
    /* ------------------------------------------------------------------ */

    function formatMs(ms) {
      const seconds = Math.max(0, Math.round(ms / 1000))
      if (seconds < 60) return `${seconds}s`
      const minutes = Math.floor(seconds / 60)
      return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
    }

    function pct(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return `${Math.round(value * 100)}%`
    }

    /* ------------------------------------------------------------------ */
    /* state store                                                         */
    /* ------------------------------------------------------------------ */

    const CLIENT_VERSION = '0.1.1-rc1'
    const monotonicNow=()=>typeof performance!=='undefined'&&typeof performance.now==='function'?performance.now():Date.now()
    const compatClamp=(n,max=.99)=>Math.max(0,Math.min(max,Number.isFinite(n)?n:0))
    const normalized=a=>{if(!a?.length||a.some(n=>!Number.isFinite(n)||n<=0))return null;const sum=a.reduce((x,y)=>x+y,0);return a.map(n=>n/sum)}
    function conservativeWork(view){
     // This seed deliberately excludes command.percent, task.percent, current.percent,
     // projectBar.percent, ETA and elapsed time. Those may describe only the current operation.
     const count=Math.max(0,Number.isFinite(view.operations?.completed)?view.operations.completed:Math.max(0,(view.steps??0)-(view.operations?.failed??0)))
     const failures=Math.max(0,view.operations?.failed??0)
     const last=view.lastTool,verified=last?.status==='completed'&&last.phase==='verify'
     const delivered=last?.status==='completed'&&last.name==='present'
     return Math.max(.01,compatClamp(delivered?.97:.78*(1-Math.exp(-count/(28+failures*3)))+(verified?.1:0)))
    }
    function fallback(view){
     const own=conservativeWork(view),plan=view.plan??{},items=Array.isArray(plan.items)?plan.items:[],children=Array.isArray(view.children)?view.children:[]
     let percent=own,weights=null,fractions=null
     if(items.length>0&&items.length===plan.total){
      weights=normalized(view.display?.weights)??normalized(items.map(i=>i.weight))??items.map(()=>1/items.length)
      // Old snapshots contain no per-item evidence; never charge the entire turn's
      // historical work to a newly-active item. Only actual completed-item credit is safe.
      fractions=items.map(i=>i.status==='completed'?1:0)
      const board=fractions.reduce((s,p,i)=>s+p*weights[i],0)
      const delegated=plan.coverage==='delegated'
      percent=delegated?.3*own+.7*board:board
     }else if((plan.total??0)>0){percent=compatClamp((plan.done??0)/plan.total)}
     if(children.length&&!items.length){
      const known=children.map(c=>c.status==='completed'?1:c.display?.percentKnown&&Number.isFinite(c.display.percent)?compatClamp(c.display.percent):0)
      percent=Math.max(own*.8,.45*own+.55*known.reduce((s,p)=>s+p,0)/known.length)
     }
     return{...view.display,percent:compatClamp(percent),percentKnown:true,indeterminate:false,estimated:true,source:'local-compat',state:'running',remainingMs:null,rangeMs:null,weights,fractions,
      local:{method:'legacy-evidence-seed-v1',kind:'general',stage:view.observedPhase??view.lastTool?.phase??'discover',events:view.operations?.completed??view.steps??0,samples:0,compatibility:true}}
    }
    function clientDisplayCompat(view,{clientVersion,serverVersion}={}){
     const display=view?.display??{}
     const compatibility={clientVersion,serverVersion:serverVersion??null,mismatch:!!serverVersion&&serverVersion!==clientVersion,reason:!serverVersion?'unknown-server-version':serverVersion!==clientVersion?'restart-required':null}
     if(!view?.sessionId||!view.running||view.turnStatus==='completed')return{display,compatibility}
     if(Number.isFinite(display.percent)&&display.percent>=0&&display.percent<=1&&display.percentKnown!==false&&display.indeterminate!==true)return{display:{...display,percentKnown:true},compatibility}
     if(view.settings?.aiEnabled===true&&Number.isFinite(display.retainedPercent))return{display,compatibility}
     // Fallback on capability absence too: a missing version field is not proof of compatibility.
     return{display:fallback(view),compatibility:{...compatibility,fallback:true,reason:compatibility.reason??'local-display-unavailable'}}
    }
    function normalizeClientProgress(data,{clientVersion}={}){
     const options={clientVersion,serverVersion:data?.plugin?.version}
     const normalize=(p)=>{
      if(!p)return p
      const children=(p.children??[]).map(c=>{const view={...c,sessionId:c.sessionId??c.id,turnStatus:c.turnStatus??c.status,running:c.status==='running',settings:c.settings??p.settings};return{...c,display:clientDisplayCompat(view,options).display}})
      const result=clientDisplayCompat({...p,children},options)
      return{...p,children,display:result.display}
     }
     return{...data,progress:normalize(data?.progress),worker:normalize(data?.worker),compatibility:clientDisplayCompat(data?.progress,options).compatibility}
    }

    function createStore() {
      const fallbackEtas=new Map()
      const withEta=p=>{if(!p?.running||p.display?.eta||!p.display?.percentKnown||!(p.display.percent>0))return p;const x=Math.min(.99,p.display.percent),elapsed=Number.isFinite(p.startedAt)&&Number.isFinite(p.updatedAt)?Math.max(0,p.updatedAt-p.startedAt):p.projectBar?.elapsedMs;if(!Number.isFinite(elapsed))return p;const key=String(p.sessionId)+':'+p.turn,signature=JSON.stringify([p.display.source,x,p.evidenceRevision,p.model?.at]),at=monotonicNow();let a=fallbackEtas.get(key);if(!a||a.signature!==signature){a={signature,at,remaining:Math.max(1000,(1/x-1)*elapsed)};fallbackEtas.delete(key);fallbackEtas.set(key,a);if(fallbackEtas.size>64)fallbackEtas.delete(fallbackEtas.keys().next().value)}const remainingMs=Math.max(1000,a.remaining-Math.max(0,at-a.at));return{...p,display:{...p.display,remainingMs,eta:{method:'elapsed-progress',id:a.at,remainingMs,precision:p.settings?.aiEnabled?'second':'minute'}}}}
      let snapshot = { status: 'loading', data: null, error: null }
      const listeners = new Set()
      let timer = null
      let inFlight = false
      let disposed = false
      let sessionId = null
      let workerId = null
      let selectedTurn = null
      let observing=false
      let revision = 0
      let controller = null
      const contexts=[],sessionSnapshots=new Map()

      const emit = () => {
        for (const listener of [...listeners]) {
          try {
            listener(snapshot)
          } catch {
            /* a broken subscriber must not stop the poller */
          }
        }
      }

      const refresh = async () => {
        if (inFlight || disposed) return
        inFlight = true
        const requestedRevision = revision
        const requestedSession = sessionId
        controller = new AbortController()
        const timeout = setTimeout(() => controller?.abort(), 10000)
        try {
          const url = (requestedSession === null ? `${API.state}?session=` : `${API.state}?session=${encodeURIComponent(requestedSession)}`)+(workerId?`&worker=${encodeURIComponent(workerId)}`:'')+(selectedTurn!==null?`&turn=${selectedTurn}`:'')
          const response = await fetch(`${url}&foreground=${observing&&typeof document!=='undefined'&&!document.hidden?'1':'0'}`, { cache: 'no-store', headers: { accept: 'application/json' }, signal: controller.signal })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const normalized=normalizeClientProgress(await response.json(),{clientVersion:CLIENT_VERSION})
          const data={...normalized,progress:withEta(normalized.progress),worker:withEta(normalized.worker)}
          if (disposed || requestedRevision !== revision) return
          snapshot = { status: 'ready', data, error: null, receivedAt: Date.now(), receivedMono:monotonicNow() }
          sessionSnapshots.delete(requestedSession);sessionSnapshots.set(requestedSession,snapshot)
          if(sessionSnapshots.size>16)sessionSnapshots.delete(sessionSnapshots.keys().next().value)
        } catch (error) {
          if (disposed || requestedRevision !== revision) return
          snapshot = {
            status: snapshot.data !== null ? 'stale' : 'error',
            data: snapshot.data,
            error: error instanceof Error ? error.message : String(error),
            receivedAt: snapshot.receivedAt,
            receivedMono:snapshot.receivedMono,
          }
        } finally {
          clearTimeout(timeout)
          controller = null
          inFlight = false
          if (!disposed) {
            emit()
            if (requestedRevision !== revision) void refresh()
          }
        }
      }

      /** Coming back to the tab should not wait out the poll interval. */
      function onVisible() {
        refresh()
      }

      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        /** The Session the page is showing; its progress is the one that matters. */
        setSession(id) {
          const next = typeof id === 'string' && id !== '' ? id : null
          if (next === sessionId) return
          sessionId = next
          workerId = null
          selectedTurn = null
          revision += 1
          controller?.abort()
          snapshot = sessionSnapshots.get(next) ?? { status: 'loading', data: snapshot.data ? { ...snapshot.data, progress: { sessionId: next, turnStatus: 'idle' } } : null, error: null }
          emit()
          refresh()
        },
        setTurn(turn){const next=Number.isSafeInteger(turn)&&turn>0?turn:null;if(next===selectedTurn)return;selectedTurn=next;workerId=null;revision++;controller?.abort();void refresh()},
        setObserving(value){if(observing===!!value)return;observing=!!value;void refresh()},
        setWorker(id){const next=typeof id==='string'&&id? id:null;if(workerId===next)return;workerId=next;revision++;controller?.abort();snapshot={...snapshot,data:snapshot.data?{...snapshot.data,worker:null}:null};emit();void refresh()},
        clearSession(id) {
          if(sessionId===id)this.setSession(null)
        },
        isSessionContext(token){return contexts.at(-1)?.token===token},
        attachSession(token,id){const next=typeof id==='string'&&id!==''?id:null;contexts.push({token,id:next});this.setSession(next)},
        detachSession(token){const index=contexts.findIndex(entry=>entry.token===token);if(index<0)return;const wasTop=index===contexts.length-1,[entry]=contexts.splice(index,1);if(wasTop&&sessionId===entry.id)this.setSession(contexts.at(-1)?.id??null)},
        refresh,
        start() {
          if (timer !== null) return
          refresh()
          timer = setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return
            refresh()
          }, POLL_MS)
          if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
        },
        stop() {
          disposed = true
          controller?.abort()
          if (timer !== null) clearInterval(timer)
          timer = null
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
          listeners.clear()
          contexts.length=0;sessionSnapshots.clear()
        },
      }
    }

    function useStore(store) {
      const [snapshot, setSnapshot] = useState(store.getSnapshot())
      useEffect(() => {
        setSnapshot(store.getSnapshot())
        return store.subscribe(setSnapshot)
      }, [store])
      return snapshot
    }

    async function postJson(url,body) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body??{}),
      })
      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (!response.ok) throw new Error(data !== null && typeof data.error === 'string' ? data.error : `HTTP ${response.status}`)
      return data
    }

    /* ------------------------------------------------------------------ */
    /* locale                                                              */
    /* ------------------------------------------------------------------ */

    function useText(ctx) {
      const read = () => {
        try {
          const locale = ctx.get('locale')
          const id = String(locale?.getLocale?.()?.id ?? '')
          return id.startsWith('zh') || id === '' ? TEXT.zh : TEXT.en
        } catch {
          return TEXT.zh
        }
      }
      const [text, setText] = useState(read)
      useEffect(() => {
        const locale = ctx.get('locale')
        if (locale === undefined || typeof locale.subscribe !== 'function') return undefined
        return locale.subscribe(() => setText(read()))
      }, [ctx])
      return text
    }

    /** Re-render once a second so clocks and countdowns actually move. */
    function useTicker(active) {
      const [now, setNow] = useState(() => Date.now())
      useEffect(() => {
        if (!active) return undefined
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [active])
      return now
    }

    /**
     * Countdown copy. A clock (7:41) rather than "7 分 41 秒": it ticks every
     * second, so it has to stay narrow enough to leave the row's subtitle room.
     */
    function formatCountdown(ms) {
      const total = Math.max(0, Math.round((typeof ms === 'number' && Number.isFinite(ms) ? ms : 0) / 1000))
      if (total < 60) return `${total} 秒`
      const minutes = Math.floor(total / 60)
      const seconds = total % 60
      return `${minutes}:${String(seconds).padStart(2, '0')}`
    }

    /* ------------------------------------------------------------------ */
    /* progress card                                                       */
    /* ------------------------------------------------------------------ */

    function Bar({ value, shimmer, tone, label = 'Progress' }) {
      const width = shimmer ? 36 : Math.max(0, Math.min(100, Math.round((value ?? 0) * 100)))
      return h(
        'div',
        { className: 'dtp-bar', 'data-shimmer': shimmer ? '1' : '0', 'data-tone': tone ?? 'accent', role: 'progressbar', 'aria-label':label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': shimmer ? undefined : width },
        h('span', { style: { width: `${width}%` } }),
      )
    }

    /** Bounded observations with accessible, horizontally scrollable point labels. */
    function ProgressTrend({points,text,workers=[]}) {
      const scroll=useRef(null),follow=useRef(true),tooltipNode=useRef(null),[tooltip,setTooltip]=useState(null)
      const topLayer=typeof window.HTMLElement?.prototype?.showPopover==='function'
      // Backdrop filters create a containing block for fixed descendants. The
      // native top layer escapes that block and every scrolling/clipping ancestor.
      useEffect(()=>{
        const node=tooltipNode.current;if(!tooltip||!topLayer||!node)return
        try{node.showPopover();const rect=node.getBoundingClientRect(),vw=window.innerWidth||1024,vh=window.innerHeight||768;node.style.left=`${Math.max(8,Math.min(vw-rect.width-8,tooltip.left))}px`;node.style.top=`${Math.max(8,Math.min(vh-rect.height-8,tooltip.bottom+8+rect.height>vh?tooltip.anchorTop-rect.height-8:tooltip.bottom+8))}px`}catch{}
        const dismiss=()=>setTooltip(null);window.addEventListener?.('resize',dismiss);window.addEventListener?.('scroll',dismiss,true)
        return()=>{window.removeEventListener?.('resize',dismiss);window.removeEventListener?.('scroll',dismiss,true);try{node.hidePopover()}catch{}}
      },[tooltip,topLayer])
      useEffect(()=>{const node=scroll.current;if(node&&follow.current)node.scrollLeft=node.scrollWidth-node.clientWidth},[points.length,points.at(-1)?.at])
      const width=Math.max(280,24+(points.length-1)*22),x=i=>points.length===1?width/2:12+i*(width-24)/Math.max(1,points.length-1),y=point=>58-point.percent*52
      const owner=point=>workers.find(worker=>worker.id===point.owner)?.label||point.ownerLabel||(point.owner?`#${String(point.owner).slice(-6)}`:point.trigger==='worker-step'?text('队友（名称不可用）','Teammate (name unavailable)'):'')
      const step=point=>point.kind==='actual'?text('实际完成','Actual completion'):point.step?`${text('第','Step ')}${point.step}${text('步','')}`:text('观察节点','Observation')
      const value=point=>`${step(point)} · ${point.kind==='actual'?'':'≈'}${Math.round(point.percent*100)}%`
      const label=point=>[owner(point),value(point)].filter(Boolean).join(' · ')
      const show=(event,point)=>{const rect=event.currentTarget.getBoundingClientRect(),vw=window.innerWidth||1024,vh=window.innerHeight||768;setTooltip({owner:owner(point),value:value(point),left:Math.max(8,Math.min(vw-248,rect.left-110)),top:rect.bottom+8>vh-100?Math.max(8,rect.top-96):rect.bottom+8,bottom:rect.bottom,anchorTop:rect.top})}
      return h('div',{className:'dtp-trend-plot'},h('div',{ref:scroll,className:'dtp-trend-scroll',onScroll:event=>{const node=event.currentTarget;follow.current=node.scrollWidth-node.clientWidth-node.scrollLeft<24;setTooltip(null)},tabIndex:0,role:'region','aria-label':text('进度变化，可左右滚动，聚焦或悬停查看节点','Progress history; scroll horizontally and focus or hover a point')},h('svg',{viewBox:`0 0 ${width} 76`,style:{width:`${width}px`},className:'dtp-sparkline',role:'group','aria-label':text('本轮进度观察','Progress observations')},
        h('path',{d:`M12 58H${width-12}`,stroke:'currentColor',opacity:.14}),h('polyline',{points:points.map((point,i)=>`${x(i)},${y(point)}`).join(' '),fill:'none',stroke:'var(--dsw-alias-brand-primary)',strokeWidth:2,strokeLinejoin:'round'}),
        ...points.map((point,i)=>h('g',{key:`${point.at}:${i}`,className:'dtp-trend-point'},h('circle',{cx:x(i),cy:y(point),r:9,fill:'transparent',tabIndex:0,role:'img','aria-label':label(point),onMouseEnter:()=>setTooltip(null),onMouseLeave:()=>{},onFocus:event=>show(event,point),onBlur:()=>setTooltip(null),onKeyDown:event=>{if(event.key==='Escape')setTooltip(null)}},!tooltip?h('title',null,label(point)):null),h('circle',{cx:x(i),cy:y(point),r:point.kind==='actual'?3.5:2.5,pointerEvents:'none',fill:point.kind==='actual'?'var(--dsw-alias-label-primary)':'var(--dsw-alias-brand-primary)'}))))),tooltip?h('div',{ref:tooltipNode,className:'dtp-point-tooltip',role:'tooltip',popover:topLayer?'manual':undefined,style:topLayer?{left:tooltip.left,top:tooltip.top,maxHeight:'calc(100dvh - 16px)'}:{position:'relative',left:0,top:0,maxWidth:'100%',marginTop:4}},tooltip.owner?h('div',{className:'dtp-point-owner'},tooltip.owner):null,h('div',null,tooltip.value)):null)
    }

    /** `PanelInfo.activePanelId === null` means the Conversation is on screen. */
    const selectConversationShown = (info) => info === null || info === undefined || info.activePanelId === null || info.activePanelId === undefined

    /** Fallback for a page without the layout plugin: nothing to hide behind. */
    const noPanelHook = () => true

    /** "6 分 20 秒" / "1 小时 6 分" / "40 秒". */
    function formatDuration(ms, coarse) {
      const totalSeconds = Math.max(0, Math.round((typeof ms === 'number' && Number.isFinite(ms) ? ms : 0) / 1000))
      const hours = Math.floor(totalSeconds / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      const seconds = totalSeconds % 60
      if (hours > 0) return `${hours} 小时 ${minutes} 分`
      if (minutes > 0) return coarse ? `${minutes} 分` : `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`
      return `${seconds} 秒`
    }

    /** m:ss — short enough to sit in a metadata line. */
    function formatClock(ms) {
      const totalSeconds = Math.max(0, Math.round((typeof ms === 'number' && Number.isFinite(ms) ? ms : 0) / 1000))
      const hours = Math.floor(totalSeconds / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      const seconds = totalSeconds % 60
      return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : `${minutes}:${String(seconds).padStart(2, '0')}`
    }

    /** One bar: label, what it is, the number on the right, then the bar. */
    function Block({ label, subtitle, value, percent, shimmer, tone, title, meta, noBar }) {
      return h(
        'div',
        { className: 'dtp-block', 'data-compact':noBar?'1':'0' },
        h(
          'div',
          { className: 'dtp-labelrow' },
          h('span', { className: 'dtp-k' }, label),
          h('span', { className: 'dtp-sub', title: title ?? subtitle }, subtitle),
          h('span', { className: 'dtp-v' }, value),
        ),
        noBar ? null : h(Bar, { value: percent, shimmer, tone, label:`${label} · ${subtitle ?? ''}` }),
        meta ? h('div', {className:'dtp-operationmeta'}, meta) : null,
      )
    }

    /** Place the overlay below the visible workspace header, including the empty conversation. */
    function useHeaderTop(sessionId,visible) {
      const [top,setTop]=useState(12)
      useEffect(()=>{
        if(!visible||typeof document==='undefined')return
        const headers=()=>[...document.querySelectorAll('header,[role="banner"]')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<160&&r.bottom>0})
        const measure=()=>{const bottom=Math.max(0,...headers().map(el=>el.getBoundingClientRect().bottom));const next=Math.min(Math.max(12,bottom+12),Math.max(12,window.innerHeight-120));setTop(value=>value===next?value:next)}
        measure()
        const observer=typeof ResizeObserver==='function'?new ResizeObserver(measure):null
        for(const header of headers())observer?.observe(header)
        window.addEventListener('resize',measure)
        return()=>{observer?.disconnect();window.removeEventListener('resize',measure)}
      },[sessionId,visible])
      return top
    }

    const POSITION_KEY='dsh-task-progress.panel.position.v2',LEGACY_POSITION_KEY='dsh-task-progress.panel.position.v1'
    function useDraggablePanel(defaultTop,collapsed) {
      const overlay=useRef(null),drag=useRef(null)
      const [dragging,setDragging]=useState(false)
      const [viewport,setViewport]=useState(()=>({width:window.innerWidth,height:window.innerHeight}))
      const [compactWidth,setCompactWidth]=useState(112)
      const [position,setPosition]=useState(()=>{
        try{
          const p=JSON.parse(window.localStorage.getItem(POSITION_KEY))
          if(p&&['left','right'].includes(p.side)&&Number.isFinite(p.edge)&&Number.isFinite(p.y))return{side:p.side,edge:Math.max(8,p.edge),y:Math.max(8,p.y)}
          const old=JSON.parse(window.localStorage.getItem(LEGACY_POSITION_KEY))
          if(old&&['x','y','vw','vh'].every(k=>Number.isFinite(old[k]))&&old.vw>0&&old.vh>0){const width=collapsed?112:352,side=old.x+width/2<old.vw/2?'left':'right';return{side,edge:Math.max(8,side==='left'?old.x:old.vw-old.x-width),y:Math.max(8,old.y)}}
        }catch{}
        return null
      })
      // This ref is the last input position, never overwritten by a stale render.
      const positionRef=useRef(position)
      const expandedWidth=Math.min(352,Math.max(80,viewport.width-(viewport.width<=600?20:32)))
      const width=collapsed?compactWidth:expandedWidth
      const projected=position??{side:'right',edge:viewport.width<=600?10:20,y:defaultTop}
      const edge=Math.max(8,Math.min(projected.edge,Math.max(8,viewport.width-width-8)))
      const top=Math.max(8,Math.min(projected.y,Math.max(8,viewport.height-88)))
      const save=p=>{try{if(p)window.localStorage.setItem(POSITION_KEY,JSON.stringify(p));else window.localStorage.removeItem(POSITION_KEY);window.localStorage.removeItem(LEGACY_POSITION_KEY)}catch{}}
      const put=p=>{positionRef.current=p;setPosition(p)}
      const reset=()=>{drag.current=null;setDragging(false);put(null);save(null)}
      const interactive=event=>!!event.target?.closest?.('button,input,select,a,[role="switch"]')
      useEffect(()=>{
        const resize=()=>setViewport({width:window.innerWidth,height:window.innerHeight})
        window.addEventListener('resize',resize)
        return()=>window.removeEventListener('resize',resize)
      },[])
      useEffect(()=>{
        const measure=()=>{if(collapsed){const w=overlay.current?.getBoundingClientRect().width;if(w>0)setCompactWidth(old=>Math.abs(old-w)<.5?old:w)}}
        measure();const observer=typeof ResizeObserver==='function'?new ResizeObserver(measure):null
        if(overlay.current)observer?.observe(overlay.current)
        return()=>observer?.disconnect()
      },[collapsed])
      // Size changes only project an anchor into the viewport; they never write
      // the projection back. Collapsing therefore returns to the saved pill.
      const anchorAt=(x,y,w)=>{
        const vw=window.innerWidth,vh=window.innerHeight,left=Math.max(8,Math.min(x,Math.max(8,vw-w-8)))
        const side=left+w/2<vw/2?'left':'right'
        return{side,edge:Math.round(side==='left'?left:vw-left-w),y:Math.round(Math.max(8,Math.min(y,Math.max(8,vh-88))))}
      }
      const start=event=>{
        if(event.button!==0||interactive(event))return
        const rect=overlay.current?.getBoundingClientRect();if(!rect)return
        event.preventDefault();drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,width:rect.width,original:positionRef.current,last:positionRef.current,moved:false}
        event.currentTarget.focus?.({preventScroll:true})
        try{event.currentTarget.setPointerCapture(event.pointerId)}catch{}
        setDragging(true)
      }
      const move=event=>{
        const d=drag.current;if(!d||d.id!==event.pointerId)return
        if(Math.hypot(event.clientX-d.x,event.clientY-d.y)<3&&!d.moved)return
        d.moved=true;d.last=anchorAt(d.left+event.clientX-d.x,d.top+event.clientY-d.y,d.width);put(d.last)
      }
      const finish=event=>{
        const d=drag.current;if(!d||d.id!==event.pointerId)return
        if(event.type==='pointerup'&&Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)&&Math.hypot(event.clientX-d.x,event.clientY-d.y)>=3){d.moved=true;d.last=anchorAt(d.left+event.clientX-d.x,d.top+event.clientY-d.y,d.width)}
        drag.current=null;setDragging(false)
        if(d.moved){put(d.last);save(d.last)}
        try{if(event.type!=='lostpointercapture')event.currentTarget.releasePointerCapture(event.pointerId)}catch{}
      }
      const rollback=()=>{const d=drag.current;if(!d)return;drag.current=null;setDragging(false);put(d.original)}
      const keyDown=event=>{
        if(event.target!==event.currentTarget)return
        if(event.key==='Home'){event.preventDefault();reset();return}
        if(event.key==='Escape'){rollback();return}
        const offsets={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]},offset=offsets[event.key]
        if(!offset)return
        const r=overlay.current?.getBoundingClientRect();if(!r)return
        event.preventDefault();const next=anchorAt(r.left+offset[0],r.top+offset[1],r.width);put(next);save(next)
      }
      return{overlay,reset,dragging,style:{[projected.side]:edge,[projected.side==='left'?'right':'left']:'auto',top,'--dtp-top':`${top}px`,'--dtp-expanded-width':`${expandedWidth}px`},header:{onPointerDown:start,onPointerMove:move,onPointerUp:finish,onPointerCancel:finish,onLostPointerCapture:finish,onKeyDown:keyDown,tabIndex:0}}
    }

    function ProgressPanel({ ctx, store, usePanelInfo }) {
      const t = useText(ctx)
      const en = t === TEXT.en
      const snapshot = useStore(store)
      const usePanel = typeof usePanelInfo === 'function' ? usePanelInfo : noPanelHook
      const onConversation = usePanel(selectConversationShown)
      const [collapsed, setCollapsed] = useState(() => {
        try { return window.localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
      })
      const [details, setDetails] = useState(false)
      const [aiBusy,setAiBusy]=useState(false)
      const [aiError,setAiError]=useState('')
      const [updateConfirm,setUpdateConfirm]=useState(false),[updateBusy,setUpdateBusy]=useState(false)
      useEffect(()=>{setUpdateConfirm(false)},[snapshot.data?.update?.version])
      useEffect(()=>{if(!updateConfirm)return;const timer=setTimeout(()=>setUpdateConfirm(false),8000);return()=>clearTimeout(timer)},[updateConfirm])
      const detailsButton = useRef(null)
      const detailsId = useRef(`dtp-details-${Math.random().toString(36).slice(2)}`)
      const [focusedWorker,setFocusedWorker]=useState(null)
      const root=snapshot.data?.progress
      const focused=focusedWorker&&(root?.children??[]).find(child=>child.id===focusedWorker)
      const own=snapshot.data?.worker
      const p=focused?own?.sessionId===focused.id?own:{...focused,sessionId:focused.id,turn:0,turnStatus:focused.status,running:focused.status==='running',projectBar:{elapsedMs:focused.elapsedMs},plan:{items:[],done:focused.done,total:focused.total},children:[],display:focused.display,settings:root.settings}:root
      useEffect(()=>{store.setWorker?.(focused?.id??null)},[store,focused?.id])
      useEffect(()=>{setFocusedWorker(null)},[root?.sessionId,root?.turn])
      const updating = false
      const running = p?.running === true
      const connected = snapshot.status === 'ready'
      const stale = snapshot.status === 'stale' || snapshot.status === 'error'
      const now = useTicker(onConversation && connected && (running || updating))
      const headerTop=useHeaderTop(p?.sessionId,onConversation)
      const panelPosition=useDraggablePanel(headerTop,collapsed)
      useEffect(() => { setDetails(false) }, [p?.sessionId, p?.turn])
      useEffect(()=>{store.setObserving?.(onConversation);return()=>store.setObserving?.(false)},[store,onConversation])
      if (!onConversation) return null

      const text = (zh, english) => en ? english : zh
      const status = p?.turnStatus ?? 'idle'
      const bar = p?.projectBar ?? {}
      const display = p?.display ?? {percent:0,percentKnown:false,indeterminate:true,source:'activity',state:status}
      const hasSession = !!p?.sessionId
      const drift = connected && running ? Math.max(0, Math.min(60000, now-(snapshot.receivedAt ?? now))) : 0
      const retained=running&&!display.percentKnown&&Number.isFinite(display.retainedPercent)
      const percent = updating ? 0 : status === 'completed' ? 1 : Math.max(0,Math.min(.99,(retained?display.retainedPercent:display.percent) ?? 0))
      const determinate=updating||status==='completed'||display.percentKnown===true||retained
      const percentText = p?.unavailable?text('未记录','Not recorded'):determinate ? `${display.estimated||retained?'≈':''}${Math.round(percent*100)}%` : running?text('进行中','Working'):status==='interrupted'?t.interrupted:text('待开始','Ready')
      const elapsed = (ms) => typeof ms === 'number' ? ms+drift : null
      const duration = (ms) => {
        if(ms>0&&ms<1000)return en?'<1s':'<1秒'
        const s = Math.max(0,Math.floor((ms ?? 0)/1000)), m = Math.floor(s/60), h = Math.floor(m/60)
        if(en) return h ? `${h}h ${m%60}m` : m ? `${m}m ${String(s%60).padStart(2,'0')}s` : `${s}s`
        return h ? `${h}小时${m%60}分` : m ? `${m}分${String(s%60).padStart(2,'0')}秒` : `${s}秒`
      }
      const taskTimeDrift=connected&&running?Math.max(0,typeof snapshot.receivedMono==='number'?monotonicNow()-snapshot.receivedMono:drift):0
      const taskRemaining=running&&Number.isFinite(display.remainingMs)?Math.max(1000,display.remainingMs-taskTimeDrift):null
      const taskRemainingText=taskRemaining===null?text('剩余≈估算中','Remaining ≈ estimating'):settingsForTime() ? `${text('剩余≈','Remaining ≈ ')}${duration(taskRemaining)}`:taskRemaining<60000?text('剩余≈<1分','Remaining ≈ <1m'):`${text('剩余≈','Remaining ≈ ')}${Math.ceil(taskRemaining/60000)}${text('分','m')}`
      function settingsForTime(){return (p?.settings??{}).aiEnabled===true}
      const countdown = (ms) => {
        const s = Math.max(1,Math.ceil(ms/1000)), m = Math.floor(s/60), h = Math.floor(m/60)
        return h ? `${h}:${String(m%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}` : `${m}:${String(s%60).padStart(2,'0')}`
      }
      const remaining = (row) => {
        if (!row?.known || !Number.isFinite(row.remainingMs)) return null
        const left = row.remainingMs-drift
        return left > 0 ? left : null
      }
      const state=stale?'disconnected':!hasSession?'idle':status==='completed'?'completed':status==='interrupted'?'interrupted':display.state??status
      const phases={answering:text('正在输出答复','Writing response'),planning:text('任务规划','Planning'),searching:text('查找与定位','Searching'),reading:text('阅读与定位','Reading'),writing:text('编写内容','Writing'),editing:text('修改调整','Editing'),installing:text('安装依赖','Installing'),building:text('构建项目','Building'),executing:text('运行命令','Running commands'),fixing:text('修复问题','Fixing'),testing:text('运行测试','Testing'),reviewing:text('检查结果','Reviewing'),previewing:text('检查效果','Checking visuals'),documenting:text('编写说明','Documenting'),packaging:text('整理产物','Packaging'),delivering:text('交付结果','Delivering'),finishing:text('收尾检查','Final checks'),coordinating:text('协调团队','Coordinating'),waiting:text('等待外部操作','Waiting'),processing:text('继续处理','Processing'),discover:text('分析与准备','Exploring'),implement:text('构建与实现','Implementing'),verify:text('检查与验证','Validating'),deliver:text('整理与交付','Delivering'),wait:text('等待外部操作','Waiting'),unknown:text('正在处理','Processing')}
      const phaseText=updating?t.updating:state==='disconnected'?text('连接中断','Disconnected'):state==='completed'?t.done:state==='interrupted'?t.interrupted:!running?hasSession?text('等待新任务','Ready'):t.noSession:phases[display.detailPhase??display.phase??p?.phase]??phases.unknown
      const sourceNames={'local-estimate':text('本地工作量估计','Local work estimate'),'local-weighted':text('本地加权估计','Local weighted estimate'),'local-counts':text('本地清单摘要','Local checklist summary'),'local-bridge':text('本地清单衔接','Local checkpoint'),weighted:text('AI任务权重','AI task weights'),model:text('AI估计','AI estimate'),plan:text('清单完成度','Checklist completion'),activity:text('实际执行记录','Observed activity'),completed:text('实际完成','Completed')}
      const sourceText=sourceNames[display.source]??text('实际执行记录','Observed activity')
      const age=typeof display.ageMs==='number'?display.ageMs+drift:0
      const settings=p?.settings??{aiEnabled:false,aiScope:'all',cadence:'balanced'},observer=p?.observer??{}
      const changeAi=async(value)=>{setAiBusy(true);setAiError('');try{await postJson(API.preferences,value);await store.refresh()}catch(error){setAiError(error.message)}finally{setAiBusy(false)}}
      const estimateOnce=async()=>{setAiBusy(true);setAiError('');try{await postJson(`${API.probe}?session=${encodeURIComponent(p.sessionId)}`);await store.refresh()}catch(error){setAiError(error.message)}finally{setAiBusy(false)}}
      const plan = p?.plan ?? {items:[],done:bar.done ?? 0,total:bar.total ?? 0}
      const completedPlanIds = new Set(plan.items.filter(item=>item.status==='completed').map(item=>String(item.id)))
      const commands = p?.commands ?? (p?.command?.active ? [p.command] : [])
      const children = p?.children ?? []
      const runningChildren=children.filter(child=>child.status==='running').length,completedChildren=children.filter(child=>child.status==='completed').length
      const childSummary=runningChildren?`${runningChildren} ${text('运行中','running')}${completedChildren?` · ${completedChildren} ${text('已完成','done')}`:''}`:completedChildren===children.length?`${completedChildren} ${text('已完成','completed')}`:text('已停止','Stopped')
      const toolNames = en ? {present:'Deliver files',run_code:'Execute tools',job_output:'Read background output',pwsh:'Command',exec_command:'Command',bash:'Command',read:'Read file',write:'Write file',edit:'Edit file',glob:'Find files',grep:'Search files',web_fetch:'Read page',web_search:'Search web',read_image:'Read image',todo_write:'Update tasks','todo/write':'Update tasks',skill:'Read skill',spawn_teammate:'Start teammate',team_task_create:'Create team task',team_task_update:'Update team task',team_task_get:'Read team task',team_task_list:'Review team tasks',list_agents:'Review teammates',wait_agent:'Wait for teammates',send_message:'Coordinate with teammate'} : {present:'交付文件',run_code:'执行工具',job_output:'读取后台输出',pwsh:'运行命令',exec_command:'运行命令',bash:'运行命令',read:'读取文件',write:'写入文件',edit:'编辑文件',glob:'查找文件',grep:'搜索内容',web_fetch:'读取网页',web_search:'搜索网页',read_image:'查看图片',todo_write:'更新清单','todo/write':'更新清单',skill:'读取技能',spawn_teammate:'创建队友',team_task_create:'创建团队任务',team_task_update:'更新团队任务',team_task_get:'读取团队任务',team_task_list:'查看团队任务',list_agents:'查看队友',wait_agent:'等待队友',send_message:'协调队友'}
      const currentOperation=commands.filter(row=>!row.infinite).at(-1)??p?.preparing
      const localStage=({discover:text('搜集与分析','Gathering and analysis'),implement:text('产出与完善','Producing and refining'),verify:text('核对与验证','Checking and validation'),deliver:text('整理与交付','Preparing delivery')})[display.local?.stage]??phaseText
      const localSummary=display.source?.startsWith('local-')?(p?.task?.label?`${text('推进任务','Working on task')} · ${p.task.label}`:`${({research:text('资料调研','Research'),build:text('项目实现','Implementation'),writing:text('内容创作','Writing'),general:text('整体任务','Overall task')})[display.local?.kind]??text('整体任务','Overall task')} · ${localStage}`):null
      const summary=p?.unavailable?text('未记录此轮进度','No progress recorded for this turn'):display.source==='final-response'?text('正在输出答复','Writing response'):updating?t.updating:status==='completed'?text('任务已完成','Task completed'):status==='interrupted'?text('任务已停止','Task stopped'):!running?text('等待开始','Ready to start'):localSummary??(currentOperation?`${!commands.length&&p?.preparing?text('准备 · ','Preparing · '):''}${toolNames[currentOperation.name]??currentOperation.name}${currentOperation.label?` · ${currentOperation.label}`:''}`:children.some(child=>child.status==='running')?text(`${children.filter(child=>child.status==='running').length} 位队友并行执行`,'Teammates working in parallel'):p?.task?.label||`${text('第','Step ')}${Math.max(1,p?.steps??1)}${text('步 · ',' · ')}${phaseText==='继续处理'?text('推敲执行方案','Working through the approach'):phaseText}`)
      const summaryCount=!focused&&bar.mode==='agents'?`${completedChildren}/${children.length} ${text('子代理','workers')}`:plan.total?`${plan.done}/${plan.total} ${text('项','tasks')}`:hasSession?`${p?.operations?.completed??0} ${text('次操作','operations')}`:''
      const commandLabel = (row) => `${toolNames[row.name] ?? row.name}${row.label ? ` · ${row.label}` : ''}`
      const commandRow = (row) => {
        const supported=['declared','history','native','native-progress','frames','ffmpeg-frames','ffmpeg-time','tqdm'].includes(row.source)
        const rest=supported?remaining(row):null,known=supported&&row.known&&(!['declared','history'].includes(row.source)||rest!==null)
        const statusText=row.state==='stopping'?text('正在停止','Stopping'):row.infinite?text('常驻服务 ∞','Service ∞'):row.state==='finishing'?text('收尾中','Finalizing'):row.stale?text('等待进度更新','Awaiting update'):row.overdue?text('超出估计 · 运行中','Estimate exceeded · running'):rest!==null?`${t.remainingAbout} ${countdown(rest)}`:text('执行中','Running')
        const count=Number.isFinite(row.current)&&Number.isFinite(row.total)?` · ${row.unit==='media-ms'?`${countdown(row.current)}/${countdown(row.total)}`:`${row.current}/${row.total}${row.unit==='frames'?text('帧',' frames'):text('项',' items')}`}${row.reset?text(' · 计数已重置',' · Counter reset'):''}`:''
        return h(Block,{key:row.id??row.name,label:toolNames[row.name]??t.command,subtitle:row.label,value:stale?t.lastKnown:statusText,percent:row.percent,shimmer:!known,noBar:row.infinite,meta:`${t.used} ${duration(elapsed(row.elapsedMs))}${count}${row.source==='history'?text(' · 历史估计',' · Historical estimate'):''}`,title:`${commandLabel(row)}${row.samples?` · ${text('历史样本','Past runs')} ${row.samples}`:''}`})
      }
      const childRow=(child)=>{
        const d=child.display??{},retained=child.status==='running'&&!d.percentKnown&&Number.isFinite(d.retainedPercent),known=child.status==='completed'||d.percentKnown===true||retained,value=child.status==='completed'?1:retained?d.retainedPercent:d.percent??0
        return h('article',{key:child.id,className:'dtp-worker','aria-label':child.label},h('button',{type:'button',className:'dtp-worker-open','aria-label':`${child.label} · ${text('查看子任务进度','View worker progress')}`,onClick:()=>{setFocusedWorker(child.id);store.setWorker?.(child.id)}},
          h('div',{className:'dtp-workername',title:child.label},child.label),
          h('div',{className:'dtp-worker-ring',title:retained?text('保留上次有效估计，正在更新','Last valid estimate; updating'):undefined,role:'progressbar','aria-label':`${child.label} ${t.progress}`,'aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':known?Math.round(value*100):undefined,'aria-valuetext':retained?`${Math.round(value*100)}% · ${text('上次估计，正在更新','Last estimate; updating')}`:known?`${Math.round(value*100)}%`:text('运行中，进度未知','Running; progress unknown')},h(Ring,{value,size:38,indeterminate:child.status==='running'&&!known,muted:['interrupted','failed'].includes(child.status)}),h('span',null,known?`${d.estimated||retained?'≈':''}${Math.round(value*100)}%`:child.status==='running'?'⋯':'—')),
          h('div',{className:'dtp-workerstatus'},child.status==='completed'?t.done:child.status==='failed'?text('失败','Failed'):child.status==='interrupted'?t.interrupted:child.status==='running'?phases[d.detailPhase??d.phase]??text('运行中','Running'):text('待命','Idle')),
          h('div',{className:'dtp-workerop',title:child.current?.label??''},child.current?`${child.current.preparing?text('准备','Preparing '):''}${toolNames[child.current.name]??child.current.name}${child.current.label?` · ${child.current.label}`:''}`:text('等待操作','No current operation')),
          h('div',{className:'dtp-operationmeta'},`${child.total?`${child.done}/${child.total} · `:''}${child.elapsedBasis==='cumulative'?text('累计','Total'):t.used} ${duration(child.elapsedMs+(child.status==='running'?drift:0))}`)))
      }
      const toggle = () => setCollapsed(previous => {
        const next=!previous
        try {window.localStorage.setItem(COLLAPSE_KEY,next?'1':'0')} catch {}
        return next
      })
      const infoGlyph = h('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,'aria-hidden':true},h('path',{d:'M9 6h11M9 12h11M9 18h11M3 6h1M3 12h1M3 18h1',strokeLinecap:'round'}))
      const chevron = h('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,'aria-hidden':true,style:{transform:collapsed?'rotate(-90deg)':'none'}},h('path',{d:'M6 9l6 6 6-6'}))
      const recentText=p?.lastTool?`${toolNames[p.lastTool.name]??p.lastTool.name}${p.lastTool.label?` · ${p.lastTool.label}`:''}`:''
      const recentOutcome=p?.lastTool?`${p.lastTool.status==='failed'?text('未成功完成','Did not complete'):p.lastTool.status==='background'?text('已转入后台','Running in background'):t.done} · ${duration(Math.max(1,p.lastTool.ms))}`:''
      const checklistContents=plan.items.length?h(React.Fragment,
        h('div',{className:'dtp-detailheading'},`${plan.coverage==='delegated'?text('分工清单','Delegated tasks'):t.todos}${plan.total?` · ${plan.done}/${plan.total}`:''}`),
        plan.items.length ? h('ol',{className:'dtp-plan'},...plan.items.map((item,index)=>h('li',{key:item.id ?? `${index}:${item.content}`,'data-state':item.status},h('span',{className:'dtp-planmark','aria-label':item.status==='completed'?t.done:item.status==='in_progress'?text('进行中','In progress'):text('待处理','Pending')},item.status==='completed'?'✓':item.status==='in_progress'?'●':String(index+1)),h('span',{className:'dtp-plantext'},item.content),display.weights?.[index]?h('span',{className:'dtp-dependent',title:plan.coverage==='delegated'?text('分工内部权重','Weight within delegated work'):text('任务权重','Task weight')},`${Math.round(display.weights[index]*100)}%`):null,item.status!=='completed'&&item.blockedBy?.some(id=>!completedPlanIds.has(String(id)))?h('span',{className:'dtp-dependent'},text('待前置任务','Blocked')):null))) : null,
        plan.total>plan.items.length ? h('p',{className:'dtp-explain'},`${text('另有','Also')} ${plan.total-plan.items.length} ${text('项未展开','items not shown')}`) : null):null
      const probeUsage=observer.turnUsage??{},probeCostLabel=text('本轮费用 ≈','Probe cost ≈')
      const probeCost=probeUsage.costPending?'…':!(probeUsage.pricedRequests>0)&&probeUsage.requests>0?'—':`¥${Number(probeUsage.costCny??0).toLocaleString('zh-CN',{maximumFractionDigits:probeUsage.costCny>0&&probeUsage.costCny<.0001?6:4})}${probeUsage.unpricedRequests>0?'+':''}`
      const probeCostTitle=(focused?text('仅此子代理的进度探针，包含本轮主任务内的续接','Only this worker’s progress probes within this main request'):text('本轮主代理及所有子代理的进度探针，按内置价格与缓存用量估算','Main and all worker progress probes; built-in prices and cache usage'))+(probeUsage.unpricedRequests?text(`；${probeUsage.unpricedRequests}次调用缺少用量或价格，显示已知费用`,`; ${probeUsage.unpricedRequests} calls lack usage or pricing; known cost only`):'')
      const historyPoints=(observer.history??[]).filter(point=>Number.isFinite(point.percent)&&point.percent<1).slice(-32)
      if(status==='completed'&&(observer.history??[]).length)historyPoints.push({percent:1,at:p?.endedAt??now,kind:'actual'})
      const update=snapshot.data?.update??{}
      const applyUpdate=async()=>{if(!updateConfirm){setUpdateConfirm(true);return}setUpdateBusy(true);setAiError('');try{await postJson(API.update,{});await store.refresh()}catch(error){setAiError(error.message)}finally{setUpdateBusy(false);setUpdateConfirm(false)}}
      const detailsContents = h('div',{id:detailsId.current,className:'dtp-details','data-content':plan.items.length||commands.length>2?'1':'0',role:'region','aria-label':text('任务进度详情','Progress details')},
        checklistContents,
        commands.length>2 ? h('div',null,h('div',{className:'dtp-detailheading'},`${text('并行操作','Parallel operations')} · ${commands.length}`),...commands.slice(2).map(commandRow)) : null,

        h('div',{id:`${detailsId.current}-diagnostics`,className:'dtp-diagnostics',role:'region','aria-label':text('预测诊断详情','Forecast diagnostics details')},
        update.error?h('p',{className:'dtp-explain',role:'status'},update.phase==='failed'?text('插件更新失败，请稍后重试。','Plugin update failed. Try again later.'):text('暂时无法检查插件更新。','Plugin updates are temporarily unavailable.')):null,
        snapshot.data?.compatibility?.mismatch?h('p',{className:'dtp-explain'},text(`客户端 ${CLIENT_VERSION} · 后端 ${snapshot.data.compatibility.serverVersion??'未知'}；重启宿主以加载更新。`,`Client ${CLIENT_VERSION} · backend ${snapshot.data.compatibility.serverVersion??'unknown'}; restart the host to load the update.`)):null,
        display.local?h('div',{className:'dtp-trend-label',title:sourceText},h('span',null,sourceText),h('span',null,`${text('有效操作','Evidence')} ${Math.round(display.local.events)} · ${text('同类样本','Prior samples')} ${display.local.samples}`)):null,
        h('div',{className:'dtp-metrics'},...[
          [text('已记录调用','Recorded calls'),observer.turnUsage?.requests??0],
          [text('输入 tokens','Input tokens'),observer.turnUsage?.inputTokens??0],
          [text('输出 tokens','Output tokens'),observer.turnUsage?.outputTokens??0],
          [probeCostLabel,probeCost],
        ].map(([label,value])=>h('div',{className:'dtp-metric',key:label,title:label===probeCostLabel?probeCostTitle:undefined},h('strong',null,typeof value==='number'?value.toLocaleString(en?'en-US':'zh-CN'):value),h('span',null,label)))),
        historyPoints.length?h('div',{className:'dtp-trend'},h('div',{className:'dtp-trend-label'},h('span',null,text('进度变化','Progress trend')),h('span',null,`${text('缓存读取','Cache read')} ${observer.turnUsage?.cacheReadTokens??0}`)),h(ProgressTrend,{points:historyPoints,text,workers:children}),h('div',{className:'dtp-trend-label'},h('span',null,text('最近观察','Recent observations')),h('span',null,`${Math.round(historyPoints.at(-1).percent*100)}%`))):h('div',{className:'dtp-diag-empty'},(observer.history??[]).length?text('已有评估，当前进度未知','Observations recorded; progress unknown'):text('尚无本轮评估记录','No observations for this request yet')),
        h('div',{className:'dtp-probe-state'},h('span',{className:'dtp-dot','data-state':observer.state==='updating'?'running':'idle'}),h('span',null,observer.state==='updating'?`${observer.assessingOwner?observer.assessingOwner+' · ':''}${text('正在评估第','Assessing step ')}${observer.assessingStep??'—'}${text('步','')}`:observer.state==='queued'?`${text('待评估','Queued')} ${observer.queuedSteps??0} ${text('步','steps')}`:!running?status==='completed'?text('本轮已完成','Request completed'):status==='interrupted'?text('本轮已停止','Request stopped'):text('等待开始','Ready'):settings.aiEnabled?settings.cadence==='step'?text('逐步精细 · 步骤结束后评估','Detailed · after each step'):settings.cadence==='every-2'?text('隔步省费 · 关键变化优先','Every other step · critical changes first'):text('智能均衡 · 关键变化优先','Balanced · critical changes first'):text('本地模式','Local mode')),h('span',{className:'dtp-latency'},observer.lastLatencyMs?`${(observer.lastLatencyMs/1000).toFixed(1)}s`:'')),
        h('div',{className:'dtp-observations','data-running':running?'1':'0'},...(observer.history??[]).slice(-3).reverse().map((point,index)=>h('div',{key:index},h('span',{title:point.ownerLabel??''},`${point.ownerLabel?point.ownerLabel+' · ':point.trigger==='worker-step'?text('队友 · ','Worker · '):''}${point.step?`${text('第','Step ')}${point.step}${text('步','')}`:text('观察节点','Observation')}`),h('span',null,point.kind==='failure'?text('未成功','Failed'):point.kind==='cancelled'?text('已取消','Cancelled'):Number.isFinite(point.percent)?point.percent>=1?text('清单已完','Checklist done'):`≈${Math.round(point.percent*100)}%`:'—'),running?h('span',null,point.at?`${duration(Math.max(0,now-point.at))}${text('前',' ago')}`:''):null))),
        h('label',{className:'dtp-diag-setting'},h('span',null,text('评估节奏','Observation mode')),h('select',{'aria-label':text('评估节奏','Observation mode'),value:settings.cadence??'balanced',disabled:aiBusy,onChange:event=>changeAi({cadence:event.target.value})},h('option',{value:'balanced'},text('智能均衡','Smart balanced')),h('option',{value:'every-2'},text('隔步省费','Every other step')),h('option',{value:'step'},text('逐步精细','Every step')))),
        h('label',{className:'dtp-diag-setting'},h('span',null,text('辅助范围','AI scope')),h('select',{'aria-label':text('AI辅助范围','AI scope'),value:settings.aiScope,disabled:aiBusy,onChange:event=>changeAi({aiScope:event.target.value})},h('option',{value:'all'},text('所有任务','All tasks')),h('option',{value:'no-plan'},text('仅无清单','Without checklist')))),
        settings.developerMode?h(ProbeDebug,{sessionId:root?.sessionId,turn:root?.turn,worker:focused?.id,text}):null,
        observer.error?h('p',{className:'dtp-explain'},text('本次评估未成功，将在后续步骤重试。','Observation failed; retrying on subsequent steps.')):null,
        h('div',{className:'dtp-diag-actions'},h('button',{type:'button',disabled:aiBusy||!running||observer.available===false||['updating','queued'].includes(observer.state),onClick:estimateOnce},text('单次估计','Estimate once')),h('button',{type:'button',onClick:()=>store.refresh()},text('刷新状态','Refresh')),h('button',{type:'button',onClick:panelPosition.reset},text('复位面板','Reset position'))),h('div',{className:'dtp-footer'},h('button',{type:'button',role:'switch',className:'dtp-ai-toggle','aria-label':text('开发者模式','Developer mode'),'aria-checked':settings.developerMode===true,disabled:aiBusy||stale||!connected,onClick:()=>changeAi({developerMode:!settings.developerMode})},text('开发者模式','Developer mode')),h('span',{className:'dtp-version'},`v${snapshot.data?.plugin?.version??CLIENT_VERSION}`))))

      return h('div',{ref:panelPosition.overlay,className:'dtp-overlay','data-dragging':panelPosition.dragging?'1':'0',style:panelPosition.style},h('section',{className:'dtp-card','data-state':state,'data-idle':running||updating?'0':'1','data-collapsed':collapsed?'1':'0','aria-label':t.progress,onKeyDown:event=>{if(event.key==='Escape'&&details){setDetails(false);detailsButton.current?.focus();event.stopPropagation()}}},
        h('div',{className:'dtp-head',...panelPosition.header,title:text('拖动移动 · Home 复位','Drag to move · Home to reset')},h(Ring,{value:percent,size:collapsed?15:21,indeterminate:running&&!determinate,muted:state==='interrupted'||state==='disconnected'}),h('span',{className:'dtp-headpct',title:retained?text('保留上次有效估计，正在更新','Last valid estimate; updating'):undefined},percentText),collapsed?null:h('span',{className:'dtp-title'},t.progress),collapsed?null:h('span',{className:'dtp-phase',title:phaseText},phaseText),h('span',{className:'dtp-grow'}),
          !collapsed&&update.available?h('button',{type:'button',className:'dtp-collapse dtp-update','aria-label':updateConfirm?text('确认更新插件','Confirm plugin update'):text('更新插件','Update plugin'),title:updateConfirm?text('再次点击安装并重启','Click again to install and restart'):`${text('更新至','Update to')} v${update.version}`,disabled:updateBusy||update.busy||running||stale,onClick:applyUpdate},updateBusy?'…':updateConfirm?'✓':'↑'):null,
          collapsed||updating?null:h('button',{type:'button',role:'switch',className:'dtp-ai-toggle','aria-label':text('AI辅助','AI assistance'),'aria-checked':settings.aiEnabled,title:`${text('AI辅助','AI assistance')} · ${settings.aiEnabled?text('开启','On'):text('关闭','Off')}`,disabled:aiBusy||stale||!connected,onClick:()=>changeAi({aiEnabled:!settings.aiEnabled})},text('AI辅助','AI assistance')),
          collapsed?null:h('button',{ref:detailsButton,type:'button',className:'dtp-collapse','aria-label':text('任务详情','Task details'),'aria-expanded':details,'aria-controls':detailsId.current,title:text('任务详情','Task details'),onClick:()=>{setDetails(v=>!v)}},infoGlyph),
          h('button',{type:'button',className:'dtp-collapse','aria-label':collapsed?t.collapsed:t.expanded,'aria-expanded':!collapsed,onClick:toggle,title:collapsed?t.collapsed:t.expanded},chevron)),
        collapsed?null:h(React.Fragment,null,
          p?.historical?h('div',{className:'dtp-history-reference'},text(`第 ${p.turn} 轮 · 历史进度`,`Turn ${p.turn} · Historical progress`)):null,
          focused?h('div',{className:'dtp-worker-nav'},h('button',{type:'button',onClick:()=>{setFocusedWorker(null);store.setWorker?.(null)}},text('‹ 主任务','‹ Main task')),h('span',{title:focused.label},focused.label)):null,
          stale?h('div',{className:'dtp-notice',role:'status'},t.disconnected):null,
          h('div',{className:'dtp-total'},h('div',{className:'dtp-totalrow'},h('span',{className:'dtp-current-summary',title:summary},summary),h('span',{className:'dtp-summary-count'},summaryCount)),h(Bar,{value:percent,shimmer:running&&!determinate,label:t.progress}),!updating&&(p?.lastTool||hasSession)?h('div',{className:'dtp-totalmeta'},p?.lastTool?h('span',{className:'dtp-recent-inline',title:`${text('最近操作','Last operation')} · ${recentText} · ${recentOutcome}`,'aria-label':`${text('最近操作','Last operation')}: ${recentText} · ${recentOutcome}`},h('span',{className:'dtp-recent-state','data-failed':p.lastTool.status==='failed'?'1':'0','aria-hidden':true},p.lastTool.status==='failed'?'!':p.lastTool.status==='background'?'↗':'✓'),h('span',{className:'dtp-recent-text'},recentText)):h('span'),h('span',{className:'dtp-task-times'},h('span',{className:'dtp-totalelapsed'},typeof bar.elapsedMs==='number'?`${focused?text('累计','Total'):t.used} ${duration(running?elapsed(bar.elapsedMs):bar.elapsedMs)}`:''),running?h('span',{className:'dtp-totalremaining',title:text('按当前进度和已用时间估算；新进展或返工时重估','Estimated from progress and elapsed time; updates with new evidence')},taskRemainingText):null)):null),
          running&&display.historicalAi?h('div',{className:'dtp-history-reference'},`${text('上次 AI 估计','Last AI estimate')} ≈${Math.round(display.historicalAi.percent*100)}%${display.source==='local-bridge'?text(' · 当前按清单衔接',' · Now following completed items'):''}${display.bridgePaused?text(' · 范围已变，暂停衔接',' · Scope changed; checkpoint paused'):''}`):null,
          !updating && running && p?.preparing ? h(Block,{label:`${text('准备','Preparing ')}${toolNames[p.preparing.name] ?? text('操作','operation')}`,subtitle:p.preparing.label,value:text('生成中','Generating'),shimmer:true,meta:`${t.used} ${duration(elapsed(p.preparing.elapsedMs))}`,title:p.preparing.label}):null,
          !updating ? commands.slice(0,2).map(commandRow):null,
          commands.length>2?h('span',{className:'dtp-more'},`+${commands.length-2} ${text('个并行操作','parallel operations')}`):null,
          children.length?h('div',{className:'dtp-children'},h('div',{className:'dtp-detailheading'},`${t.agents} · ${childSummary}`),h('div',{className:'dtp-workers','data-count':children.length,style:{gridTemplateColumns:`repeat(${children.length===1?1:children.length===2||children.length===4?2:3},minmax(0,1fr))`}},...children.map(childRow))):null,
          aiError?h('p',{className:'dtp-explain',role:'status'},text('设置或估计未成功，请稍后重试。','Could not update; try again shortly.')):null,
          details?detailsContents:null)))
    }

    /**
     * Reports which Session the page is showing. The dock is session-scoped and
     * hands the id over directly; the element itself renders nothing.
     */
    function ProbeDebug({sessionId,turn,worker,text}) {
      const [result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
      const generation=useRef(0)
      useEffect(()=>{generation.current++;setResult(null);setError('');setBusy(false);return()=>{generation.current++}},[sessionId,turn,worker])
      const url=`${API.debug}?session=${encodeURIComponent(sessionId??'')}&turn=${turn??''}${worker?`&worker=${encodeURIComponent(worker)}`:''}`
      const load=async()=>{const token=++generation.current;setBusy(true);setError('');try{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error(`HTTP ${response.status}`);const data=await response.json();if(token===generation.current)setResult(data)}catch(e){if(token===generation.current)setError(e.message)}finally{if(token===generation.current)setBusy(false)}}
      return h('div',{className:'dtp-debug'},h('p',null,text('仅开启后记录完整请求和响应，内容可能包含对话与文件片段。日志保存在本机。','Records full requests and responses while enabled. Logs may include conversation and file excerpts, and stay on this device.')),h('div',{className:'dtp-debug-controls'},h('button',{type:'button',disabled:busy,onClick:load},busy?text('读取中…','Loading…'):text('查看探针日志','View probe logs')),h('a',{href:url+'&download=1',download:`probe-logs-turn-${turn}.json`},text('下载日志','Download logs'))),error?h('p',{role:'status'},text('日志读取失败，请重试。','Could not load logs. Try again.')):null,h('div',{className:'dtp-debug-records',tabIndex:0,role:'region','aria-label':text('探针日志，可上下滚动','Probe logs; scroll vertically')},result?h(React.Fragment,null,h('div',null,`${text('已记录调用','Recorded calls')} ${result.records?.length??0}`),result.truncated?h('p',null,text('仅展示最近记录；日志按容量轮换。','Recent records only; logs rotate by size.')):null,...(result.records??[]).map((record,index)=>h(ProbeDebugRecord,{key:record.id??index,record,text}))):h('div',null,text('点击查看本轮记录','Load logs for this turn'))))
    }

    function ProbeDebugRecord({record,text}) {
      const [open,setOpen]=useState(false)
      const actor=record.actorLabel&&!/^session-|^[a-f\d]{8}-[a-f\d-]+$/i.test(record.actorLabel)?record.actorLabel:record.sessionId===record.rootSessionId?text('主代理','Main agent'):`${text('队友','Teammate')} #${String(record.sessionId??'').slice(-6)||'—'}`
      return h('details',{onToggle:event=>setOpen(event.currentTarget.open)},h('summary',null,`${actor} · ${record.startedAt?new Date(record.startedAt).toLocaleString():''} · ${record.step?text('第','Step ')+record.step+text('步',''):record.status??''}`),open?h('pre',null,JSON.stringify(record,null,2)):null)
    }

    // Use only public DOM markers emitted by the host transcript and turn rail.
    // No transcript text or internal React state is read.
    function observeReadingTurn(store,token) {
      if(typeof document.querySelectorAll!=='function')return()=>{}
      let timer=null,closed=false
      const read=()=>{
        timer=null;if(closed||!store.isSessionContext?.(token)||document.hidden)return
        const rows=[...document.querySelectorAll('[data-chat-turn]:not([hidden])')].filter(row=>!row.closest?.('[hidden]'))
        if(!rows.length)return
        const visible=rows.filter(row=>{const r=row.getBoundingClientRect();return r.width>0&&r.height>0})
        if(!visible.length)return
        const scroller=visible[0].closest?.('[data-conversation-scroll]')??visible[0].parentElement?.closest?.('[data-chat-scroll]')
        const bounds=scroller?.getBoundingClientRect()??{top:0,height:window.innerHeight}
        const line=bounds.top+Math.min(96,bounds.height*.2)
        const root=visible[0].closest?.('[data-chat-following-tail]')
        const latest=Math.max(...visible.map(row=>Number(row.getAttribute('data-chat-turn'))).filter(Number.isSafeInteger))
        const active=[...document.querySelectorAll('nav button[data-index][aria-current="true"]')].find(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0})
        const railTurn=active?Number(active.getAttribute('aria-label')?.match(/\d+/g)?.at(-1)):NaN
        let turn=null
        if(root&&(!Number.isSafeInteger(railTurn)||railTurn===latest))turn=null
        else if(Number.isSafeInteger(railTurn)&&railTurn>0)turn=railTurn
        else {
          for(const row of visible){const r=row.getBoundingClientRect(),n=Number(row.getAttribute('data-chat-turn'));if(Number.isSafeInteger(n)&&n>0&&r.top<=line)turn=n}
          if(turn===null)turn=Number(visible[0].getAttribute('data-chat-turn'))
        }
        store.setTurn(turn)
      }
      const schedule=()=>{if(timer===null&&!closed)timer=setTimeout(read,80)}
      document.addEventListener('scroll',schedule,true)
      // Ignore token-by-token markdown mutations: only transcript seats and the
      // host's active-turn markers can change the selected progress snapshot.
      const changed=records=>{if(!records||records.some(record=>record.type==='attributes'||[...(record.addedNodes??[]),...(record.removedNodes??[])].some(node=>node.nodeType===1&&(node.matches?.('[data-chat-turn],nav')||node.querySelector?.('[data-chat-turn],nav button[data-index]')))))schedule()}
      const observer=typeof MutationObserver==='function'?new MutationObserver(changed):null
      document.addEventListener('visibilitychange',schedule)
      observer?.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-current','data-chat-following-tail','data-chat-turn']})
      schedule()
      return()=>{closed=true;clearTimeout(timer);observer?.disconnect();document.removeEventListener('scroll',schedule,true);document.removeEventListener('visibilitychange',schedule)}
    }

    function SessionProbe({ store, sessionId }) {
      useEffect(() => {
        const token={};store.attachSession(token,sessionId)
        const stop=observeReadingTurn(store,token)
        return () => {stop();store.detachSession(token)}
      }, [store, sessionId])
      return null
    }

    /* ------------------------------------------------------------------ */
    /* registration                                                        */
    /* ------------------------------------------------------------------ */

    return {
      inject: ['slots'],
      apply(ctx) {
        for(const suffix of ['panel.collapsed.v2','panel.position.v2','panel.position.v1'])try{const key='dsh-task-progress.'+suffix;if(window.localStorage.getItem(key)===null){const old=window.localStorage.getItem('dsh-base.'+suffix);if(old!==null)window.localStorage.setItem(key,old)}}catch{}
        const store = createStore()

        ctx.effect(() => {
          store.start()
          return () => store.stop()
        }, 'dsh-task-progress: poller')

        ctx.effect(() => injectStyle(), 'dsh-task-progress: styles')

        const register = (slot, id, order, Component) =>
          ctx.slots.register({ name: slot, id, order }, (props) => {
            try {
              return h(Component, { ...props, ctx, store })
            } catch (error) {
              console.warn('[dsh-task-progress] render failed', error)
              return null
            }
          })

        ctx.slots.inject('conversation.composer.dock', () => {
          const dispose = ctx.slots.register({ name: 'conversation.composer.dock', id: 'dsh-task-progress-session', order: 900 }, (props) =>
            h(SessionProbe, { store, sessionId: props?.sessionId }),
          )
          return typeof dispose === 'function' ? dispose : () => {}
        })

        ctx.slots.inject('shell.overlay', () => {
          const dispose = register('shell.overlay', 'dsh-task-progress-progress', 40, ProgressPanel)
          return typeof dispose === 'function' ? dispose : () => {}
        })
      },
    }
  },
})
