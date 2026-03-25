import { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { initSocket, setRoomName, startMeeting } from "../services/mediasoupClient";

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
      <video ref={videoRef} autoPlay muted />
      <div ref={containerRef}></div>
    </div>
  );
}