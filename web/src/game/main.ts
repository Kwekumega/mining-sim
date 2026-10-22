import Phaser from "phaser";
import "./style.css";
import { GameScene } from "./scene";

new Phaser.Game({
  type: Phaser.CANVAS,
  parent: "game",
  backgroundColor: "#6f8f4e",
  scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
  render: { antialias: true, roundPixels: false },
  scene: [GameScene],
});
