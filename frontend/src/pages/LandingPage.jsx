import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function LandingPage() {
  const [username, setUsername] = useState("");
  const [roomId, setRoomId] = useState("");
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  const handleJoin = (e) => {
    e.preventDefault();
    if (!username || !roomId) return;
    navigate(`/meeting/${roomId}?name=${encodeURIComponent(username)}`);
  };

  const generateRoom = () => {
    const roomCode = Math.random().toString(36).substring(2, 8);
    setRoomId(roomCode);
    setCopied(false);
  };

  const copyLink = () => {
    if (!roomId) return;
    const url = `${window.location.origin}/meeting/${roomId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="landing-page">
      <div className="landing-card">
        <h1>Gemini Meet</h1>
        <p>Enter a name and room code to start a meeting</p>

        <form onSubmit={handleJoin}>
          <div className="input-group">
            <label htmlFor="username">Your Name</label>
            <input
              id="username"
              type="text"
              placeholder="e.g. John Doe"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="input-group">
            <label htmlFor="roomId">Room ID</label>
            <div className="room-input">
              <input
                id="roomId"
                type="text"
                placeholder="Enter room code"
                value={roomId}
                onChange={(e) => {
                  setRoomId(e.target.value);
                  setCopied(false);
                }}
                required
              />
              <button
                type="button"
                onClick={generateRoom}
                className="secondary"
              >
                Generate
              </button>
              {roomId && (
                <button
                  type="button"
                  onClick={copyLink}
                  className="secondary copy-button"
                >
                  {copied ? "Copied!" : "Copy Link"}
                </button>
              )}
            </div>
          </div>

          <button
            type="submit"
            className="primary-button"
            disabled={!username || !roomId}
          >
            Join Meeting
          </button>
        </form>
      </div>

      <style>{`
        .landing-page {
          display: grid;
          place-items: center;
          min-height: 100vh;
          background: #111318;
          color: #fff;
          padding: 1rem;
        }
        .landing-card {
          background: #1a1d24;
          padding: 2.5rem;
          border-radius: 1rem;
          width: 100%;
          max-width: 400px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.3);
        }
        h1 { margin: 0 0 0.5rem; text-align: center; }
        p { color: #888; text-align: center; margin-bottom: 2rem; }
        form { display: flex; flex-direction: column; gap: 1.5rem; }
        .input-group { display: flex; flex-direction: column; gap: 0.5rem; }
        label { font-size: 0.9rem; color: #ccc; }
        input {
          background: #252a33;
          border: 1px solid #333;
          padding: 0.8rem;
          border-radius: 0.5rem;
          color: #fff;
          font-size: 1rem;
        }
        .room-input { display: flex; gap: 0.5rem; }
        .room-input input { flex: 1; }
        button {
          font-weight: 600;
          transition: all 0.2s;
        }
        .secondary {
          background: #252a33;
          color: #ccc;
          padding: 0 1rem;
        }
        .secondary:hover { background: #303641; }
        .copy-button {
          min-width: 90px;
        }
        .primary-button {
          background: #4a6cf7;
          color: #fff;
          padding: 1rem;
          margin-top: 0.5rem;
        }
        .primary-button:hover:not(:disabled) {
          background: #3a56d4;
          transform: translateY(-1px);
        }
        .primary-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
