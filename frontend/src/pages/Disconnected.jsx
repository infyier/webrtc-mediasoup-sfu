import { useNavigate, useParams } from "react-router-dom";

export default function Disconnected() {
  const navigate = useNavigate();
  const { roomId } = useParams();

  return (
    <div style={{ textAlign: "center", marginTop: "100px" }}>
      <h2>You got disconnected</h2>

      <button onClick={() => navigate(`/meeting/${roomId}`)}>
        Rejoin Meeting
      </button>

      <button onClick={() => navigate("/")}>
        Back to Home
      </button>
    </div>
  );
}