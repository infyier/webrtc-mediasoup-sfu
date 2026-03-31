import "./App.css"
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom"
import Meeting from "./pages/Meeting"
import LandingPage from "./pages/LandingPage"
import Disconnected from "./pages/Disconnected"

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/meeting/:roomId" element={<Meeting />} />
        <Route path="/disconnected/:roomId" element={<Disconnected />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App