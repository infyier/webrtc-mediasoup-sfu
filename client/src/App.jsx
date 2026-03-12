import "./App.css"
import "./index.js"

function generateRoom() {
  const roomCode = Math.random().toString(36).substring(2, 8)
  window.location.href = `/${roomCode}`
}

function App() {
  return (
    <div id="video">

      <button onClick={generateRoom}>
        Generate Room Code
      </button>

      <table className="mainTable">
        <tbody>
          <tr>
            <td className="localColumn">
              <video id="localVideo" autoPlay className="video" muted></video>
            </td>

            <td className="remoteColumn">
              <div id="videoContainer"></div>
            </td>
          </tr>
        </tbody>
      </table>

    </div>
  )
}

export default App