import { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { initSocket, setRoomName, startMeeting, toggleMute, toggleCamera } from "../services/mediasoupClient";

export default function Meeting() {
  const { roomId } = useParams();

  const videoRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    setRoomName(roomId);
    startMeeting(roomId, videoRef.current, containerRef.current);
  }, [roomId]);

  return (
    <div>
      <div className="video-container">
      <video ref={videoRef} autoPlay muted />

      <div className="video-controls">
        <button onClick={toggleMute}>🔇</button>
        <button onClick={toggleCamera}>📷</button>
        <button onClick={() => {
          window.location.href = `/disconnected/${roomId}`;
        }}>
        ❌
        </button>
      </div>
    </div>

  <div ref={containerRef}></div>
  </div>
  );
}