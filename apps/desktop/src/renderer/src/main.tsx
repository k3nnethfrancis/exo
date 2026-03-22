import ReactDOM from "react-dom/client";
import "xterm/css/xterm.css";

import { App } from "./App";
import "./styles.css";
import "./shell.css";
import "./drawers.css";
import "./terminal.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
