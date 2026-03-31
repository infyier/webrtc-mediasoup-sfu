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
      </div>
      <div ref={containerRef}></div>
      <button onClick={toggleMute}>Mute</button>
      <button onClick={toggleCamera}>Camera</button>
      <button onClick={() => {
        window.location.href = `/disconnected/${roomId}`;
        }}>
          Leave Meeting
      </button>
    </div>
  );
}