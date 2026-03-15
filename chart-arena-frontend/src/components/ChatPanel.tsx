import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatChannel, ChatMessage } from '../hooks/useGame';
import { truncAddr } from '../utils/constants';

export function ChatPanel({ chatMessages, activeTab, unread, inGame, address, whisperTarget, onSendChat, onSetTab, onSetWhisperTarget, players }: {
    chatMessages: Record<ChatChannel, ChatMessage[]>;
    activeTab: ChatChannel;
    unread: Record<ChatChannel, number>;
    inGame: boolean;
    address: string | null;
    whisperTarget: string | null;
    onSendChat: (channel: ChatChannel, text: string, target?: string) => void;
    onSetTab: (tab: ChatChannel) => void;
    onSetWhisperTarget: (target: string | null) => void;
    players: string[];
}) {
    const [inputText, setInputText] = useState('');
    const messagesEndRef = useCallback((node: HTMLDivElement | null) => {
        node?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    const tabs: Array<{ id: ChatChannel; label: string; emoji: string }> = inGame
        ? [
            { id: 'game_room', label: 'Game', emoji: '⚔️' },
            { id: 'public', label: 'Public', emoji: '🌐' },
            { id: 'announcement', label: 'News', emoji: '📢' },
            { id: 'whisper', label: 'DM', emoji: '🤫' },
        ]
        : [
            { id: 'public', label: 'Public', emoji: '🌐' },
            { id: 'announcement', label: 'News', emoji: '📢' },
            { id: 'whisper', label: 'DM', emoji: '🤫' },
        ];

    const messages = chatMessages[activeTab] ?? [];
    const isReadOnly = activeTab === 'announcement';

    const handleSend = () => {
        const text = inputText.trim();
        if (!text) return;
        if (activeTab === 'whisper' && whisperTarget) {
            onSendChat('whisper', text, whisperTarget);
        } else if (activeTab !== 'whisper') {
            onSendChat(activeTab, text);
        }
        setInputText('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    return (
        <div className="panel chat-panel">
            {/* Tabs */}
            <div className="chat-tabs">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        className={`chat-tab ${activeTab === tab.id ? 'chat-tab--active' : ''}`}
                        onClick={() => onSetTab(tab.id)}
                    >
                        <span>{tab.emoji}</span>
                        <span>{tab.label}</span>
                        {unread[tab.id] > 0 && (
                            <span className="chat-unread">{unread[tab.id]}</span>
                        )}
                    </button>
                ))}
            </div>

            {/* Whisper target selector */}
            {activeTab === 'whisper' && (
                <div style={{ padding: '4px 8px', fontSize: '0.68rem', color: '#554d73', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {whisperTarget ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            To: <span style={{ color: '#92B4F4', fontWeight: 600 }}>{truncAddr(whisperTarget)}</span>
                            <button onClick={() => onSetWhisperTarget(null)} style={{
                                fontSize: '0.65rem', padding: '0 4px', border: 'none', background: 'transparent',
                                color: '#F4B8CE', cursor: 'pointer',
                            }}>✕</button>
                        </span>
                    ) : (
                        <>
                            <span>To:</span>
                            {players.filter(p => p !== address).map(p => (
                                <button key={p} onClick={() => onSetWhisperTarget(p)} style={{
                                    fontSize: '0.65rem', padding: '2px 6px', clipPath: "polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%)",
                                    border: '1px solid rgba(146,180,244,0.15)', background: 'rgba(146,180,244,0.04)',
                                    color: '#8b7fb0', cursor: 'pointer', fontFamily: 'var(--font-display)',
                                }}>{truncAddr(p).slice(0, 8)}</button>
                            ))}
                        </>
                    )}
                </div>
            )}

            {/* Messages */}
            <div className="chat-messages">
                {messages.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#554d73', fontSize: '0.7rem', padding: 12 }}>
                        {activeTab === 'announcement' ? 'No announcements yet' : 'Be the first to chat!'}
                    </div>
                ) : (
                    messages.map((msg) => {
                        const isSystem = msg.sender === 'SYSTEM';
                        const isSelf = msg.sender === address;
                        return (
                            <div key={msg.id} className={`chat-msg ${isSystem ? 'chat-msg--system' : ''} ${isSelf ? 'chat-msg--self' : ''}`}>
                                {!isSystem && (
                                    <span className="chat-msg__sender" style={{ color: isSelf ? '#92B4F4' : '#92B4F4' }}>
                                        {isSelf ? 'You' : msg.senderDisplay}
                                    </span>
                                )}
                                <span className="chat-msg__text">{msg.text}</span>
                                <span className="chat-msg__time">
                                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        );
                    })
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            {!isReadOnly && (
                <div className="chat-input-wrap">
                    <input
                        className="chat-input"
                        type="text"
                        placeholder={activeTab === 'whisper' && !whisperTarget ? 'Select a player first...' : 'Type a message...'}
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        maxLength={200}
                        disabled={activeTab === 'whisper' && !whisperTarget}
                    />
                    <button className="chat-send-btn" onClick={handleSend}
                        disabled={!inputText.trim() || (activeTab === 'whisper' && !whisperTarget)}>
                        ➤
                    </button>
                </div>
            )}
        </div>
    );
}

/* ═══ MECHA THEME ═══ */
