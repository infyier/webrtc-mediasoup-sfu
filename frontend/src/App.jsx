import "./App.css"
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom"
import Meeting from "./pages/Meeting"

function Landing() {
  const navigate = useNavigate()

  const generateRoom = () => {
    const roomCode = Math.random().toString(36).substring(2, 8)
    navigate(`/meeting/${roomCode}`)
  }
 
  return (
    <div>
      <h1>Landing Page</h1>
      <button onClick={generateRoom}>
        Generate Room Code
      </button>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/meeting/:roomId" element={<Meeting />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App