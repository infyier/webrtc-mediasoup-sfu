import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  startMeeting,
  stopMeeting,
  startScreenShare,
  stopScreenShare,
  toggleCamera,
  toggleMute,
  getNetworkStats,
  setPreferredLayers,
  sendMessage,
  getSocketId,
} from "../services/mediasoupClient";

function MediaElement({ stream, type, muted = false }) {
  const mediaRef = useRef(null);

  useEffect(() => {
    if (mediaRef.current) {
      mediaRef.current.srcObject = stream;
    }
  }, [stream]);

  if (!stream) return null;

  return type === "video" ? (
    <video ref={mediaRef} autoPlay playsInline muted={muted} />
  ) : (
    <audio ref={mediaRef} autoPlay />
  );
}

const GRID_GAP = 8;
const VIDEO_ASPECT_RATIO = 16 / 9;
const MAX_DESKTOP_COLUMNS = 4;

const calculateGrid = (participantCount, width, height) => {
  if (participantCount <= 1) return { columns: 1, rows: 1 };

  let bestLayout = { columns: 1, rows: participantCount, score: 0 };
  const maxColumns = Math.min(participantCount, MAX_DESKTOP_COLUMNS);

  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const rows = Math.ceil(participantCount / columns);
    const cellWidth = (width - GRID_GAP * (columns - 1)) / columns;
    const cellHeight = (height - GRID_GAP * (rows - 1)) / rows;
    const tileWidth = Math.min(cellWidth, cellHeight * VIDEO_ASPECT_RATIO);
    const tileHeight = tileWidth / VIDEO_ASPECT_RATIO;
    const tileArea = tileWidth * tileHeight;
    const finalRowCount = participantCount % columns || columns;
    const finalRowOccupancy = finalRowCount / columns;
    const score = tileArea * finalRowOccupancy;

    if (score >= bestLayout.score) {
      bestLayout = { columns, rows, score };
    }
  }

  return { columns: bestLayout.columns, rows: bestLayout.rows };
};

function RemoteParticipant({ participant, label, style }) {
  return (
    <div
      className={`video-container remote-tile ${participant.muted ? "muted" : ""}`}
      style={style}
    >
      <MediaElement stream={participant.videoStream} type="video" />
      <MediaElement stream={participant.audioStream} type="audio" />

      <span className="participant-label">{label}</span>

      {(!participant.videoStream || participant.cameraOff) && (
        <div className="camera-off-overlay">Camera Off</div>
      )}

      {participant.muted && <span className="status-badge">Muted</span>}

      {participant.videoProducerId && !participant.cameraOff && (
        <select
          className="quality-select"
          defaultValue="2"
          onChange={(e) =>
            setPreferredLayers(participant.videoProducerId, Number(e.target.value)).catch(() => {})
          }
        >
          <option value="2">High (Auto)</option>
          <option value="1">Medium</option>
          <option value="0">Low</option>
        </select>
      )}
    </div>
  );
}

export default function Meeting() {
  const { roomId } = useParams();
  const [searchParams] = useSearchParams();
  const userName = searchParams.get("name") || "Anonymous";
  const navigate = useNavigate();
  const localVideoRef = useRef(null);
  const gridRef = useRef(null);
  const [participants, setParticipants] = useState([]);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [networkStats, setNetworkStats] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const chatOpenRef = useRef(chatOpen);
  const [participantsOpen, setParticipantsOpen] = useState(false);

  const participantCount = participants.length + 1;
  const [gridLayout, setGridLayout] = useState({ columns: 1, rows: 1 });

  useEffect(() => {
    chatOpenRef.current = chatOpen;
  }, [chatOpen]);

  useEffect(() => {
    startMeeting({
      roomId,
      name: userName,
      localVideoElement: localVideoRef.current,
      onParticipants: setParticipants,
      onDisconnect: () => navigate(`/disconnected/${roomId}`),
      onMessage: (message) => {
        setMessages((prev) => [...prev, message]);
        if (!chatOpenRef.current) {
          setUnreadCount((prev) => prev + 1);
        }
      },
    });

    return stopMeeting;
  }, [navigate, roomId, userName]);

  useEffect(() => {
    const id = setInterval(async () => {
      const stats = await getNetworkStats();
      if (stats) setNetworkStats(stats);
    }, 2000);
    return () => clearInterval(id);
  }, []);

  useLayoutEffect(() => {
    const gridElement = gridRef.current;
    if (!gridElement) return undefined;

    const updateGrid = () => {
      const { width, height } = gridElement.getBoundingClientRect();
      setGridLayout(calculateGrid(participantCount, width, height));
    };
    const resizeObserver = new ResizeObserver(updateGrid);

    resizeObserver.observe(gridElement);
    updateGrid();

    return () => resizeObserver.disconnect();
  }, [participantCount]);

  const getTileStyle = (index) => {
    const remainder = participantCount % gridLayout.columns;
    const firstTileInLastRow = participantCount - remainder;

    if (remainder > 0 && index === firstTileInLastRow) {
      return {
        gridColumn: `${gridLayout.columns - remainder + 1} / span 2`,
      };
    }

    return undefined;
  };

  const handleMute = async () => {
    setMuted(await toggleMute());
  };

  const handleCamera = async () => {
    setCameraOff(await toggleCamera());
  };

  const handleScreenShare = async () => {
    if (screenSharing) {
      setScreenSharing(await stopScreenShare());
    } else {
      setScreenSharing(await startScreenShare(() => setScreenSharing(false)));
    }
  };

  const handleSendMessage = async (text) => {
    try {
      const msg = await sendMessage(text);
      setMessages((prev) => [...prev, msg]);
    } catch (err) {
      console.error("Failed to send message:", err);
    }
  };

  const leaveMeeting = () => {
    stopMeeting();
    navigate(`/disconnected/${roomId}`);
  };

  return (
    <main className="meeting">
      <header className="meeting-header">
        <span>Room: {roomId}</span>
        <div className="header-actions">
          <button
            type="button"
            className="chat-toggle-btn"
            onClick={() => setParticipantsOpen(!participantsOpen)}
          >
            {participantCount}{" "}
            {participantCount === 1 ? "participant" : "participants"}
          </button>
          <button
            type="button"
            className={`chat-toggle-btn ${unreadCount > 0 ? "has-unread" : ""}`}
            onClick={() => {
              setChatOpen(!chatOpen);
              setUnreadCount(0);
            }}
          >
            Chat {unreadCount > 0 ? `(${unreadCount})` : ""}
          </button>
        </div>
      </header>

      <div className="meeting-body">
        <div className="video-grid-container">
          <div
            ref={gridRef}
            className={`video-grid ${participantCount > 12 ? "scrollable-grid" : ""}`}
            style={{
              "--grid-columns": gridLayout.columns * 2,
              "--grid-rows": gridLayout.rows,
            }}
          >
            <div
              className={`video-container local-tile ${muted ? "muted" : ""} ${screenSharing ? "screen-sharing" : ""}`}
              style={getTileStyle(0)}
            >
              <video ref={localVideoRef} autoPlay playsInline muted />

              <span className="participant-label">{userName} (You)</span>
              {cameraOff && <div className="camera-off-overlay">Camera Off</div>}
              {muted && <span className="status-badge">Muted</span>}
              {networkStats && (
                <span className="network-stats">
                  {networkStats.bitrate} kbps · {networkStats.packetLoss}% loss
                </span>
              )}

              <div className="video-controls">
                <button type="button" onClick={handleMute}>
                  {muted ? "Unmute" : "Mute"}
                </button>
                <button type="button" onClick={handleCamera}>
                  {cameraOff ? "Camera On" : "Camera Off"}
                </button>
                <button type="button" onClick={handleScreenShare}>
                  {screenSharing ? "Stop Share" : "Share Screen"}
                </button>
                <button
                  type="button"
                  className="leave-button"
                  onClick={leaveMeeting}
                >
                  Leave
                </button>
              </div>
            </div>

            {participants.map((participant, index) => (
              <RemoteParticipant
                key={participant.peerId}
                participant={participant}
                label={participant.name}
                style={getTileStyle(index + 1)}
              />
            ))}
          </div>
        </div>

        {participantsOpen && (
          <ParticipantsPanel
            localUser={{ name: userName, muted, cameraOff }}
            participants={participants}
            onClose={() => setParticipantsOpen(false)}
          />
        )}

        {chatOpen && (
          <ChatPanel
            messages={messages}
            onSendMessage={handleSendMessage}
            onClose={() => setChatOpen(false)}
          />
        )}
      </div>
    </main>
  );
}

function ChatPanel({ messages, onSendMessage, onClose }) {
  const [text, setText] = useState("");
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSendMessage(text.trim());
    setText("");
  };

  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        <span>Chat</span>
        <button type="button" className="chat-panel-close" onClick={onClose}>
          &times;
        </button>
      </div>

      <div className="chat-messages-container">
        {messages.length === 0 ? (
          <div className="chat-empty-state">No messages yet.</div>
        ) : (
          messages.map((msg) => {
            const isSelf = msg.senderId === getSocketId();
            return (
              <div
                key={msg.id}
                className={`chat-message ${isSelf ? "chat-message-self" : "chat-message-other"}`}
              >
                {!isSelf && <div className="chat-message-sender">{msg.name}</div>}
                <div className="chat-message-bubble">
                  <div className="chat-message-text">{msg.text}</div>
                  <div className="chat-message-time">
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Send a message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

function ParticipantsPanel({ localUser, participants, onClose }) {
  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        <span>Participants ({participants.length + 1})</span>
        <button type="button" className="chat-panel-close" onClick={onClose}>
          &times;
        </button>
      </div>
      <div className="participants-list">
        <div className="participant-item">
          <span className="participant-item-name">{localUser.name} (You)</span>
          <span className="participant-item-status">
            {localUser.muted && "🔇"}
            {localUser.cameraOff && "📷"}
          </span>
        </div>
        {participants.map((p) => (
          <div key={p.peerId} className="participant-item">
            <span className="participant-item-name">{p.name}</span>
            <span className="participant-item-status">
              {p.muted && "🔇"}
              {p.cameraOff && "📷"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
