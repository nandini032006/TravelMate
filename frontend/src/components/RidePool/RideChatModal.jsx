import { useState, useEffect, useRef } from 'react'

function fmtTime(offsetMin = 0) {
  const d = new Date()
  d.setMinutes(d.getMinutes() + offsetMin)
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function seedMessages(match) {
  const d = match.driver
  const veh = `${d.vehicle.type === 'bike' ? '🏍' : '🚗'} ${d.vehicle.model}`
  return [
    { id: 1, type: 'system', text: 'Ride coordination chat. Phone numbers are hidden for privacy.' },
    { id: 2, type: 'driver', text: `Hi! I'm ${d.name.split(' ')[0]}. I'll be at the pickup in ~${Math.min(match.etaMin, 9)} minutes. Look for my ${veh}.`, time: fmtTime(-6) },
    { id: 3, type: 'driver', text: `I'll pick you up at ${match.pickup}. Ping me if you need anything!`, time: fmtTime(-3) },
  ]
}

const AUTO_REPLIES = {
  default: "👍 Got it, see you at the pickup point!",
  where:   (match) => `I'm near ${match.pickup} now, about 2 min away.`,
  wait:    "Sure! I'll wait at the pickup, take your time.",
  thanks:  "No problem! Safe journey 🙏",
  cancel:  "Okay, noted. I'll mark the seat as available.",
}

function getAutoReply(text, match) {
  const t = text.toLowerCase()
  if (t.includes('where') || t.includes('location') || t.includes('reach')) return AUTO_REPLIES.where(match)
  if (t.includes('wait') || t.includes('late') || t.includes('minute')) return AUTO_REPLIES.wait
  if (t.includes('thank') || t.includes('ok') || t.includes('fine'))    return AUTO_REPLIES.thanks
  if (t.includes('cancel') || t.includes('not coming'))                  return AUTO_REPLIES.cancel
  return AUTO_REPLIES.default
}

export function RideChatModal({ match, onClose }) {
  const key = `travelmate_chat_${match.id}`
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(key)) || seedMessages(match) }
    catch { return seedMessages(match) }
  })
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify(messages)) } catch {}
  }, [messages, key])

  function send() {
    const text = input.trim()
    if (!text) return
    const now = fmtTime(0)
    setMessages(prev => [...prev, { id: Date.now(), type: 'user', text, time: now }])
    setInput('')
    setTimeout(() => {
      setMessages(prev => [...prev, {
        id: Date.now() + 1, type: 'driver',
        text: getAutoReply(text, match), time: fmtTime(0),
      }])
    }, 1500 + Math.random() * 1000)
  }

  const d = match.driver
  return (
    <div className="chat-modal" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="chat-modal__panel">
        <div className="chat-modal__header">
          <div className="chat-modal__driver-avatar" style={{ background: d.avatarColor }}>{d.initials}</div>
          <div className="chat-modal__driver-info">
            <span className="chat-modal__driver-name">{d.name}</span>
            <span className="chat-modal__driver-sub">
              {d.vehicle.type === 'bike' ? '🏍' : '🚗'} {d.vehicle.model} · ★{d.rating}
            </span>
          </div>
          <button className="chat-modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="chat-modal__messages">
          {messages.map(msg => (
            <div key={msg.id} className={`chat-modal__row chat-modal__row--${msg.type}`}>
              {msg.type === 'system' ? (
                <div className="chat-modal__system">{msg.text}</div>
              ) : (
                <div className="chat-modal__bubble-wrap">
                  {msg.type === 'driver' && (
                    <div className="chat-modal__mini-av" style={{ background: d.avatarColor }}>{d.initials[0]}</div>
                  )}
                  <div>
                    <div className={`chat-modal__bubble chat-modal__bubble--${msg.type}`}>{msg.text}</div>
                    {msg.time && <div className="chat-modal__time">{msg.time}</div>}
                  </div>
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="chat-modal__input-row">
          <input
            className="chat-modal__input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="Type a message…"
          />
          <button className="chat-modal__send-btn" onClick={send} disabled={!input.trim()}>➤</button>
        </div>
      </div>
    </div>
  )
}
