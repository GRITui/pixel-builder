// Synthetic reference images for tests and look-scripts (no binary fixtures in the repo).
import { blankImage, type RgbaImage } from "./png";

type C = [number, number, number];
const fill = (img: RgbaImage, x0: number, y0: number, x1: number, y1: number, c: C) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.rgba.set([...c, 255], (y * img.width + x) * 4);
};

/** Concept-art figure on a flat backdrop: brown hair, skin face, red shirt, blue trousers, dark boots. */
export function characterConcept(): RgbaImage {
  const img = blankImage(80, 140, [235, 235, 235, 255]);
  fill(img, 28, 8, 52, 18, [90, 55, 30]); // hair
  fill(img, 30, 18, 50, 32, [230, 180, 140]); // face
  fill(img, 22, 36, 58, 78, [200, 40, 40]); // red shirt
  fill(img, 14, 38, 22, 70, [200, 40, 40]);
  fill(img, 58, 38, 66, 70, [200, 40, 40]);
  fill(img, 26, 80, 54, 118, [50, 70, 190]); // blue trousers
  fill(img, 24, 120, 56, 134, [45, 35, 30]); // boots
  return img;
}

/** House photo stand-in (wide two-storey): red roof, timber upper storey, brick lower storey, dark door, sky backdrop. */
export function houseConcept(): RgbaImage {
  const img = blankImage(180, 130, [150, 200, 240, 255]);
  for (let y = 0; y < 30; y++) {
    const inset = Math.round((30 - y) * 0.9);
    fill(img, 14 + inset, 6 + y, 166 - inset, 7 + y, [190, 45, 40]); // roof
  }
  fill(img, 20, 36, 160, 70, [165, 115, 60]); // timber upper
  for (const x of [34, 74, 114]) fill(img, x, 44, x + 14, 60, [90, 130, 160]);
  fill(img, 20, 70, 160, 120, [160, 85, 65]); // brick lower
  fill(img, 80, 84, 100, 120, [60, 40, 30]); // door
  return img;
}
