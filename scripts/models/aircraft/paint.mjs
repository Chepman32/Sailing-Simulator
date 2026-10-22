// Canvas painting helpers for aircraft liveries. Each Surface owns three
// layers in UV space: base colour, a height field that becomes the tangent
// space normal map (panel seams, rivets, hinge lines), and a glTF
// metallic-roughness map (G = roughness, B = metalness).

import * as THREE from "three";

function canvas(width, height) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return element;
}

export class Surface {
  /**
   * @param width/height texture size in pixels
   * @param metersU/metersV physical size the UV square covers, so text and
   *        rivet spacing are painted at true scale despite stretched UVs.
   */
  constructor(width, height, metersU, metersV, { base = "#ffffff", roughness = 0.35, metalness = 0 } = {}) {
    this.width = width;
    this.height = height;
    this.pxU = width / metersU;
    this.pxV = height / metersV;
    this.colorCanvas = canvas(width, height);
    this.heightCanvas = canvas(width, height);
    this.ormCanvas = canvas(width, height);
    this.color = this.colorCanvas.getContext("2d");
    this.bump = this.heightCanvas.getContext("2d");
    this.orm = this.ormCanvas.getContext("2d");
    this.color.fillStyle = base;
    this.color.fillRect(0, 0, width, height);
    this.bump.fillStyle = "rgb(128,128,128)";
    this.bump.fillRect(0, 0, width, height);
    this.setFinish(0, 0, 1, 1, roughness, metalness);
  }

  x(u) {
    return u * this.width;
  }

  y(v) {
    return v * this.height;
  }

  /** Paints the roughness/metalness of a UV rectangle. */
  setFinish(u0, v0, u1, v1, roughness, metalness = 0) {
    this.orm.fillStyle = `rgb(255,${Math.round(roughness * 255)},${Math.round(metalness * 255)})`;
    this.orm.fillRect(this.x(u0), this.y(v0), this.x(u1) - this.x(u0), this.y(v1) - this.y(v0));
  }

  rect(u0, v0, u1, v1, style) {
    this.color.fillStyle = style;
    this.color.fillRect(this.x(u0), this.y(v0), this.x(u1) - this.x(u0), this.y(v1) - this.y(v0));
  }

  /**
   * Fills the region between two curves v = top(u) and v = bottom(u) for u in
   * [u0, u1]. Used for cheat lines that follow the fuselage and swoosh up the tail.
   */
  band(u0, u1, top, bottom, style, layer = this.color, steps = 96) {
    layer.fillStyle = style;
    layer.beginPath();
    for (let step = 0; step <= steps; step += 1) {
      const u = u0 + ((u1 - u0) * step) / steps;
      const point = [this.x(u), this.y(top(u))];
      if (step === 0) layer.moveTo(...point);
      else layer.lineTo(...point);
    }
    for (let step = steps; step >= 0; step -= 1) {
      const u = u0 + ((u1 - u0) * step) / steps;
      layer.lineTo(this.x(u), this.y(bottom(u)));
    }
    layer.closePath();
    layer.fill();
  }

  /** Runs draw(context) in a frame centred on (u, v) measured in meters, optionally mirrored. */
  inMeters(u, v, mirrorU, mirrorV, draw, layers = [this.color]) {
    layers.forEach((layer) => {
      layer.save();
      layer.translate(this.x(u), this.y(v));
      layer.scale(mirrorU ? -this.pxU : this.pxU, mirrorV ? -this.pxV : this.pxV);
      draw(layer);
      layer.restore();
    });
  }

  /**
   * Draws text whose cap height is heightMeters at its true aspect ratio.
   * mirrorU/mirrorV select the reading orientation for the side of the
   * aircraft it is painted on.
   */
  text(text, u, v, heightMeters, { mirrorU = false, mirrorV = false, style = "#111", font = "800", stroke, align = "center" } = {}) {
    const ratio = this.pxU / this.pxV;
    const layer = this.color;
    layer.save();
    layer.translate(this.x(u), this.y(v));
    layer.scale(mirrorU ? -ratio : ratio, mirrorV ? -1 : 1);
    layer.font = `${font} ${heightMeters * this.pxV * 1.38}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
    layer.textAlign = align;
    layer.textBaseline = "middle";
    if (stroke) {
      layer.lineJoin = "round";
      layer.lineWidth = heightMeters * this.pxV * 0.16;
      layer.strokeStyle = stroke;
      layer.strokeText(text, 0, 0);
    }
    layer.fillStyle = style;
    layer.fillText(text, 0, 0);
    layer.restore();
  }

  /** A recessed seam (normal map) with a faint grime line in the colour layer. */
  seamU(u, v0, v1, grime = 0.08) {
    this.bump.strokeStyle = "rgb(70,70,70)";
    this.bump.lineWidth = Math.max(1.2, this.pxU * 0.006);
    this.bump.beginPath();
    this.bump.moveTo(this.x(u), this.y(v0));
    this.bump.lineTo(this.x(u), this.y(v1));
    this.bump.stroke();
    this.color.strokeStyle = `rgba(0,0,0,${grime})`;
    this.color.lineWidth = 1;
    this.color.beginPath();
    this.color.moveTo(this.x(u), this.y(v0));
    this.color.lineTo(this.x(u), this.y(v1));
    this.color.stroke();
  }

  seamV(v, u0, u1, grime = 0.08) {
    this.bump.strokeStyle = "rgb(70,70,70)";
    this.bump.lineWidth = Math.max(1.2, this.pxV * 0.006);
    this.bump.beginPath();
    this.bump.moveTo(this.x(u0), this.y(v));
    this.bump.lineTo(this.x(u1), this.y(v));
    this.bump.stroke();
    this.color.strokeStyle = `rgba(0,0,0,${grime})`;
    this.color.lineWidth = 1;
    this.color.beginPath();
    this.color.moveTo(this.x(u0), this.y(v));
    this.color.lineTo(this.x(u1), this.y(v));
    this.color.stroke();
  }

  /** Rivet heads along a seam: tiny raised dots in the height field. */
  rivetsU(u, v0, v1, spacingMeters) {
    const count = Math.floor(((v1 - v0) * this.height) / (spacingMeters * this.pxV));
    this.bump.fillStyle = "rgb(165,165,165)";
    const radius = Math.max(0.7, this.pxU * 0.004);
    for (let index = 0; index <= count; index += 1) {
      const y = this.y(v0) + index * spacingMeters * this.pxV;
      this.bump.beginPath();
      this.bump.arc(this.x(u) + radius * 2.2, y, radius, 0, Math.PI * 2);
      this.bump.fill();
    }
  }

  /** Rounded rectangle in meters around (u, v), drawn on the given layers. */
  roundedRect(u, v, widthMeters, heightMeters, radiusMeters, style, layers = [this.color]) {
    layers.forEach((layer) => {
      layer.save();
      layer.translate(this.x(u), this.y(v));
      layer.scale(this.pxU, this.pxV);
      layer.fillStyle = typeof style === "function" ? style(layer) : style;
      layer.beginPath();
      layer.roundRect(-widthMeters / 2, -heightMeters / 2, widthMeters, heightMeters, radiusMeters);
      layer.fill();
      layer.restore();
    });
  }

  /** Converts the painted height field into a tangent-space normal map. */
  normalCanvas(strength = 2.2) {
    const { width, height } = this;
    const source = this.bump.getImageData(0, 0, width, height).data;
    const output = canvas(width, height);
    const context = output.getContext("2d");
    const image = context.createImageData(width, height);
    const sample = (x, y) => source[(Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4] / 255;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const dx = (sample(x + 1, y) - sample(x - 1, y)) * strength;
        const dy = (sample(x, y + 1) - sample(x, y - 1)) * strength;
        const length = Math.hypot(dx, dy, 1);
        const index = (y * width + x) * 4;
        image.data[index] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
        image.data[index + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
        image.data[index + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
        image.data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    return output;
  }

  /** Builds a PBR material from the painted layers. */
  material(name, { normalStrength = 2.2, envMapIntensity = 1 } = {}) {
    const texture = (source, colorSpace) => {
      const value = new THREE.CanvasTexture(source);
      // glTF texture space: v = 0 is the top row, matching the painted canvas.
      value.flipY = false;
      value.colorSpace = colorSpace;
      value.wrapS = THREE.ClampToEdgeWrapping;
      value.wrapT = THREE.ClampToEdgeWrapping;
      value.anisotropy = 8;
      return value;
    };
    const orm = texture(this.ormCanvas, THREE.NoColorSpace);
    const material = new THREE.MeshStandardMaterial({
      name,
      map: texture(this.colorCanvas, THREE.SRGBColorSpace),
      normalMap: texture(this.normalCanvas(normalStrength), THREE.NoColorSpace),
      roughnessMap: orm,
      metalnessMap: orm,
      roughness: 1,
      metalness: 1,
      envMapIntensity,
    });
    return material;
  }
}

/** Plain PBR material for small untextured parts. */
export function finish(name, color, roughness, metalness, extra = {}) {
  return new THREE.MeshStandardMaterial({ name, color, roughness, metalness, ...extra });
}
