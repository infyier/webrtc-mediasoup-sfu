import "./App.css"
import "./index.js"

function App() {
  return (
    <div id="video">
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