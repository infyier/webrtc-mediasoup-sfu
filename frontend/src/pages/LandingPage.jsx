import { useNavigate } from "react-router-dom";

export default function LandingPage() {
  const navigate = useNavigate();

  const generateRoom = () => {
    const roomCode = Math.random().toString(36).substring(2, 8);
    navigate(`/meeting/${roomCode}`);
  };

  return (
    <div>
      <h1>Landing Page</h1>
      <button onClick={generateRoom}>
        Generate Room Code
      </button>
    </div>
  );
}