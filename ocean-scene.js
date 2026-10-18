/* Dependency-free WebGL seascape. The page owns the motion preference. */
(() => {
  "use strict";
  const canvas = document.getElementById("ocean-canvas");
  if (!canvas) return;
  const root = document.documentElement;
  const shipSpace = document.querySelector(".voyage-scene-space");
  let shipAnchor = null;
  let gl;
  try { gl = canvas.getContext("webgl", { alpha: false, antialias: true, powerPreference: "low-power" }); } catch (_) { return; }
  if (!gl) return;

  let frame = 0, request = 0, previous = 0, elapsed = 0, lastPaint = 0, lost = false;
  let width = 1, height = 1, mobile = false, scrollTarget = 0, scroll = 0;
  let px = 0, py = 0, tx = 0, ty = 0;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const matrix = {
    multiply(a, b) {
      const out = new Float32Array(16);
      for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return out;
    },
    perspective(aspect) {
      const f = 1 / Math.tan(Math.PI / 7.8), near = 0.3, far = 240;
      return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
    },
    look(eye, target) {
      const z = normalize(subtract(eye, target));
      const x = normalize(cross([0, 1, 0], z));
      const y = cross(z, x);
      return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
    },
    boat(x, y, z, yaw, roll, pitch, scale) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const translation = new Float32Array([scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, x, y, z, 1]);
      const rotation = matrix.multiply(new Float32Array([cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1]), matrix.multiply(new Float32Array([cr, sr, 0, 0, -sr, cr, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), new Float32Array([1, 0, 0, 0, 0, cp, sp, 0, 0, -sp, cp, 0, 0, 0, 0, 1])));
      return matrix.multiply(translation, rotation);
    }
  };
  function subtract(a, b) { return a.map((v, i) => v - b[i]); }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function normalize(v) { const l = Math.hypot(...v) || 1; return v.map(n => n / l); }
  function program(vertex, fragment, names) {
    const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    const prefix = precision && precision.precision > 0 ? "precision highp float;\n" : "precision mediump float;\n";
    const shaders = [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, prefix + fragment]].map(([type, source]) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error("Ocean shader unavailable"); }
      return shader;
    });
    const id = gl.createProgram(); shaders.forEach(s => gl.attachShader(id, s)); gl.linkProgram(id); shaders.forEach(s => gl.deleteShader(s));
    if (!gl.getProgramParameter(id, gl.LINK_STATUS)) throw new Error("Ocean program unavailable");
    const uniforms = {};
    names.forEach(name => { uniforms[name] = gl.getUniformLocation(id, name); });
    return { id, uniforms };
  }

  // Mesh positions are world-space, so the horizon and waves respond to the camera.
  let sky, sea, boat, oceanMesh, hullMesh, sailMesh, rearMesh, flagTexture, skyBuffer;
  try {
    sky = program("attribute vec2 aPosition;varying vec2 vUv;void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}", `
      varying vec2 vUv;uniform float uTime;uniform float uAspect;
      float cloud(vec2 p){return sin(p.x*2.3+sin(p.y*4.))*sin(p.y*7.+p.x*.7);}
      void main(){
        vec3 horizon=vec3(.36,.64,.66), upper=vec3(.075,.25,.34);
        vec3 color=mix(horizon,upper,smoothstep(.36,1.,vUv.y));
        vec2 sun=vUv-vec2(.79,.76);sun.x*=uAspect;
        float d=length(sun);color+=vec3(.65,.42,.16)*exp(-d*7.)*.45;
        color=mix(color,vec3(.99,.87,.61),1.-smoothstep(.019,.023,d));
        float c=smoothstep(.4,.8,cloud(vec2(vUv.x*5.+uTime*.006,vUv.y*3.)))*smoothstep(.45,.7,vUv.y);
        color=mix(color,vec3(.73,.81,.78),c*.12);
        color*=mix(.68,1.04,smoothstep(0.,.85,vUv.x));gl_FragColor=vec4(color,1.);
      }`, ["uTime", "uAspect"]);
    sea = program(`
      precision highp float;attribute vec3 aPosition;uniform mat4 uVP;uniform float uTime;
      varying vec3 vWorld;varying vec3 vNormal;varying float vHeight;
      void main(){
        vec2 p=aPosition.xz;
        float a=dot(p,vec2(.34,.18))-uTime*.86;
        float b=dot(p,vec2(-.19,.43))-uTime*1.19;
        float c=dot(p,vec2(.77,.55))+uTime*1.7;
        float h=sin(a)*.29+sin(b)*.15+sin(c)*.045;
        vec2 slope=cos(a)*vec2(.34,.18)*.29+cos(b)*vec2(-.19,.43)*.15+cos(c)*vec2(.77,.55)*.045;
        vWorld=vec3(p.x,h,p.y);vNormal=normalize(vec3(-slope.x,1.,-slope.y));vHeight=h;
        gl_Position=uVP*vec4(vWorld,1.);
      }`, `
      varying vec3 vWorld;varying vec3 vNormal;varying float vHeight;
      uniform vec3 uEye;uniform vec2 uResolution;uniform float uTime;
      float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
      void main(){
        vec3 N=normalize(vNormal),V=normalize(uEye-vWorld),L=normalize(vec3(.6,.75,.35));
        float fresnel=pow(1.-max(dot(N,V),0.),3.);
        vec3 water=mix(vec3(.018,.23,.29),vec3(.055,.48,.49),clamp(vHeight+.48,0.,1.));
        water=mix(water,vec3(.33,.61,.63),fresnel*.72);
        float sparkle=pow(max(dot(reflect(-L,N),V),0.),110.);
        float grain=noise(vWorld.xz*1.8+vec2(uTime*.13,-uTime*.18));
        float foam=smoothstep(.30,.44,vHeight)*smoothstep(.22,.75,grain)*.48;
        water=mix(water,vec3(.78,.89,.83),foam);
        water+=vec3(1.,.85,.56)*sparkle*.8;
        float fog=1.-exp(-max(length(vWorld.xz-uEye.xz)-28.,0.)*.025);
        water=mix(water,vec3(.34,.61,.63),fog*.88);
        water*=mix(.68,1.08,smoothstep(.02,.8,gl_FragCoord.x/uResolution.x));
        gl_FragColor=vec4(water,1.);
      }`, ["uVP", "uTime", "uEye", "uResolution"]);
    boat = program(`
      precision highp float;attribute vec3 aPosition;attribute vec3 aNormal;attribute vec3 aColor;attribute vec2 aUv;
      uniform mat4 uVP;uniform mat4 uModel;uniform vec2 uClipShift;varying vec3 vNormal;varying vec3 vColor;varying vec2 vUv;
      void main(){vec4 p=uVP*uModel*vec4(aPosition,1.);p.xy+=uClipShift*p.w;gl_Position=p;vNormal=normalize(mat3(uModel)*aNormal);vColor=aColor;vUv=aUv;}
      `, `
      varying vec3 vNormal;varying vec3 vColor;varying vec2 vUv;uniform sampler2D uFlag;uniform float uTextured;
      void main(){vec3 n=normalize(vNormal);float light=.62+.38*abs(dot(n,normalize(vec3(.3,.85,.6))));vec4 decal=texture2D(uFlag,vUv);vec3 color=mix(vColor,decal.rgb,decal.a*uTextured);gl_FragColor=vec4(color*light,1.);}
      `, ["uVP", "uModel", "uClipShift", "uFlag", "uTextured"]);
    skyBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, skyBuffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    oceanMesh = makeOcean();
    const shapes = makeBoat(); hullMesh = upload(shapes.hull); sailMesh = upload(shapes.main); rearMesh = upload(shapes.rear);
    flagTexture = makeFlag();
  } catch (_) {
    canvas.dataset.renderer = "fallback";
    return;
  }

  function makeOcean() {
    const columns = 144, rows = 120, vertices = [], indices = [];
    for (let z = 0; z <= rows; z += 1) for (let x = 0; x <= columns; x += 1) {
      const u = x / columns * 2 - 1;
      vertices.push(Math.sign(u) * Math.pow(Math.abs(u), 1.35) * 130, 0, 18 - Math.pow(z / rows, 1.35) * 185);
    }
    for (let z = 0; z < rows; z += 1) for (let x = 0; x < columns; x += 1) {
      const i = z * (columns + 1) + x;
      indices.push(i, i + 1, i + columns + 1, i + 1, i + columns + 2, i + columns + 1);
    }
    const position = gl.createBuffer(), index = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, position); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    return { position, index, count: indices.length };
  }

  function makeBoat() {
    const hull = [], main = [], rear = [];
    const wood = [.49, .25, .12], gold = [.89, .56, .18], cream = [.95, .88, .66], red = [.72, .23, .12], ink = [.12, .16, .17];
    function triangle(out, a, b, c, color, uv = [[0, 0], [1, 0], [1, 1]]) {
      const normal = normalize(cross(subtract(b, a), subtract(c, a)));
      [a, b, c].forEach((p, i) => out.push(...p, ...normal, ...color, ...uv[i]));
    }
    function quad(out, a, b, c, d, color, uv) {
      triangle(out, a, b, c, color, uv && [uv[0], uv[1], uv[2]]);
      triangle(out, a, c, d, color, uv && [uv[0], uv[2], uv[3]]);
    }
    function box(cx, cy, cz, sx, sy, sz, color) {
      const v = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map(p => [cx + p[0] * sx / 2, cy + p[1] * sy / 2, cz + p[2] * sz / 2]);
      [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]].forEach(f => quad(hull, ...f.map(i => v[i]), color));
    }
    function rod(a, b, radius, color, sides = 7) {
      const direction = normalize(subtract(b, a));
      const u = normalize(cross(direction, Math.abs(direction[1]) > .9 ? [1, 0, 0] : [0, 1, 0]));
      const v = cross(direction, u);
      const point = (center, angle) => center.map((n, i) => n + radius * (u[i] * Math.cos(angle) + v[i] * Math.sin(angle)));
      for (let i = 0; i < sides; i += 1) {
        const p = i / sides * Math.PI * 2, q = (i + 1) / sides * Math.PI * 2;
        quad(hull, point(a, p), point(b, p), point(b, q), point(a, q), color);
        triangle(hull, b, point(b, p), point(b, q), color);
      }
    }
    function sphere(center, size, color, slices = 10, bands = 6) {
      function point(a, b) { return [center[0] + Math.cos(a) * Math.sin(b) * size[0], center[1] + Math.cos(b) * size[1], center[2] + Math.sin(a) * Math.sin(b) * size[2]]; }
      for (let i = 0; i < slices; i += 1) for (let j = 0; j < bands; j += 1) {
        const a = i / slices * Math.PI * 2, b = j / bands * Math.PI, c = (i + 1) / slices * Math.PI * 2, d = (j + 1) / bands * Math.PI;
        quad(hull, point(a, b), point(c, b), point(c, d), point(a, d), color);
      }
    }
    // Three tapered hull rings, a real deck, and a raised quarterdeck.
    const rings = [[.42, 1], [-.13, .94], [-.7, .53]];
    const ringPoint = (i, ring) => { const a = i / 22 * Math.PI * 2; return [Math.cos(a) * 3.05 * ring[1], ring[0], Math.sin(a) * 1.12 * ring[1]]; };
    for (let k = 0; k < 2; k += 1) for (let i = 0; i < 22; i += 1) {
      quad(hull, ringPoint(i, rings[k]), ringPoint(i + 1, rings[k]), ringPoint(i + 1, rings[k + 1]), ringPoint(i, rings[k + 1]), i % 2 ? wood : [.58, .30, .13]);
    }
    for (let i = 0; i < 22; i += 1) {
      triangle(hull, [0, .42, 0], ringPoint(i, rings[0]), ringPoint(i + 1, rings[0]), cream);
      rod(ringPoint(i, [.56, 1]), ringPoint(i + 1, [.56, 1]), .055, gold, 5);
    }
    box(1.55, .79, -.05, 1.5, .72, 1.45, [.87, .81, .63]); box(1.55, 1.21, -.05, 1.8, .14, 1.65, red);
    for (let i = 0; i < 3; i += 1) sphere([1.05 + i * .45, .88, .69], [.14, .16, .025], ink, 8, 4);
    box(1.9, 1.58, -.1, .64, .62, .73, cream); box(1.9, 1.93, -.1, .82, .11, .89, gold);
    rod([-.8, .42, 0], [-.8, 5.8, 0], .075, wood); rod([1.5, 1.25, 0], [1.5, 4.25, 0], .055, wood);
    rod([-2.85, 4.95, .04], [1.2, 4.95, .04], .055, wood); rod([.1, 3.72, -.04], [2.9, 3.72, -.04], .045, wood);
    rod([-.8, 5.5, 0], [-2.65, .58, .82], .016, [.40, .34, .23], 4);
    rod([-.8, 5.5, 0], [2.3, .58, -.78], .016, [.40, .34, .23], 4);
    rod([1.5, 4.2, 0], [2.7, .58, .66], .016, [.40, .34, .23], 4);
    // Lion figurehead: golden mane, pale face, ears and small dark eyes.
    sphere([-2.93, .94, .67], [.53, .54, .23], gold);
    for (let i = 0; i < 10; i += 1) {
      const a = i / 10 * Math.PI * 2;
      sphere([-2.93 + Math.cos(a) * .51, .94 + Math.sin(a) * .51, .72], [.15, .14, .12], [.82, .39, .13], 5, 3);
    }
    sphere([-2.93, .94, .9], [.36, .36, .11], cream);
    sphere([-3.07, 1.02, 1.01], [.037, .048, .025], ink, 6, 3); sphere([-2.79, 1.02, 1.01], [.037, .048, .025], ink, 6, 3);
    sphere([-2.93, .86, 1.025], [.075, .055, .025], wood, 6, 3);
    rod([-3.0, .55, 0], [-3.9, .85, 0], .035, wood);
    function sail(out, center, bottom, top, halfWidth, striped) {
      const columns = 12, rows = 10;
      function point(u, v) { return [center + (u - .5) * halfWidth * 2 * (.83 + .17 * v), bottom + v * (top - bottom) - .13 * Math.sin(u * Math.PI), .15 + .5 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI)]; }
      for (let i = 0; i < columns; i += 1) for (let j = 0; j < rows; j += 1) {
        const u = i / columns, v = j / rows, U = (i + 1) / columns, V = (j + 1) / rows;
        quad(out, point(u, v), point(U, v), point(U, V), point(u, V), striped && i % 3 === 0 ? red : cream, [[u, v], [U, v], [U, V], [u, V]]);
      }
    }
    sail(main, -.8, 1.75, 4.9, 1.92, false); sail(rear, 1.55, 2.25, 3.68, 1.29, true);
    quad(rear, [-.8, 5.69, 0], [.22, 5.63, .08], [.12, 5.03, .02], [-.8, 5.11, 0], ink);
    return { hull, main, rear };
  }

  function upload(vertices) {
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    return { buffer, count: vertices.length / 11 };
  }
  function makeFlag() {
    const image = document.createElement("canvas"); image.width = 256; image.height = 256;
    const c = image.getContext("2d");
    if (c) {
      c.translate(128, 140); c.lineCap = "round"; c.lineJoin = "round";
      function bones(color, width) { c.strokeStyle = color; c.lineWidth = width; [[-62, -38, 61, 54], [61, -38, -61, 54]].forEach(a => { c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(a[2], a[3]); c.stroke(); }); }
      bones("#293a39", 17); bones("#f8f0d9", 11);
      c.fillStyle = "#f9f2db"; c.strokeStyle = "#293a39"; c.lineWidth = 3;
      c.beginPath(); c.ellipse(0, -5, 40, 35, 0, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillRect(-25, 16, 50, 29); c.strokeRect(-25, 16, 50, 29);
      c.fillStyle = "#293a39"; [-15, 15].forEach(x => { c.beginPath(); c.ellipse(x, -6, 9, 12, x * .014, 0, Math.PI * 2); c.fill(); });
      c.beginPath(); c.moveTo(0, 8); c.lineTo(-5, 16); c.lineTo(5, 16); c.fill();
      c.lineWidth = 2; c.beginPath(); c.moveTo(-24, 31); c.lineTo(24, 31); [-12, 0, 12].forEach(x => { c.moveTo(x, 20); c.lineTo(x, 43); }); c.stroke();
      c.fillStyle = "#dab15e"; c.beginPath(); c.ellipse(0, -35, 53, 12, 0, 0, Math.PI * 2); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(-31, -38); c.quadraticCurveTo(-33, -74, 0, -74); c.quadraticCurveTo(33, -74, 31, -38); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = "#b84a35"; c.fillRect(-31, -47, 62, 9);
    }
    const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  const enabledAttributes = new Set();
  function useProgram(id) {
    enabledAttributes.forEach(location => gl.disableVertexAttribArray(location));
    enabledAttributes.clear();
    gl.useProgram(id);
  }
  function bindAttribute(id, name, size, stride = 0, offset = 0) {
    const location = gl.getAttribLocation(id, name);
    if (location >= 0) { gl.enableVertexAttribArray(location); enabledAttributes.add(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset); }
  }
  function cacheShipAnchor() {
    if (!shipSpace) { shipAnchor = null; return; }
    const rect = shipSpace.getBoundingClientRect();
    shipAnchor = { x: rect.left + rect.width * .5, y: rect.bottom - 54, span: Math.min(rect.width * .82, 280) };
  }
  function draw(t) {
    if (lost) return;
    const aspect = width / height;
    px += (tx - px) * .035; py += (ty - py) * .035; scroll += (scrollTarget - scroll) * .03;
    const eye = [px * .42 + Math.sin(t * .23) * .13, mobile ? 7.2 : 6.4 + Math.sin(t * .31) * .11, mobile ? 21 : 18];
    const target = [px * .3, -.1 + py * .15 - scroll * .1, -24];
    const vp = matrix.multiply(matrix.perspective(aspect), matrix.look(eye, target));
    gl.viewport(0, 0, canvas.width, canvas.height); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    useProgram(sky.id); gl.bindBuffer(gl.ARRAY_BUFFER, skyBuffer); bindAttribute(sky.id, "aPosition", 2);
    gl.uniform1f(sky.uniforms.uTime, t); gl.uniform1f(sky.uniforms.uAspect, aspect); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT);
    useProgram(sea.id); gl.bindBuffer(gl.ARRAY_BUFFER, oceanMesh.position); bindAttribute(sea.id, "aPosition", 3);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, oceanMesh.index); gl.uniformMatrix4fv(sea.uniforms.uVP, false, vp);
    gl.uniform1f(sea.uniforms.uTime, t); gl.uniform3fv(sea.uniforms.uEye, eye); gl.uniform2f(sea.uniforms.uResolution, canvas.width, canvas.height);
    gl.drawElements(gl.TRIANGLES, oceanMesh.count, gl.UNSIGNED_SHORT, 0);
    let bx = 8.8, bz = -10, boatScale = 1.2, drawShip = true;
    if (mobile && shipAnchor) {
      // Intersect the journal's boat position with the sea plane. Moving only
      // clip-space Y makes an otherwise visible boat disappear behind the water.
      const forward = normalize(subtract(target, eye));
      const right = normalize(cross(forward, [0, 1, 0]));
      const up = cross(right, forward);
      const f = 1 / Math.tan(Math.PI / 7.8);
      const nx = (shipAnchor.x / width * 2 - 1) * aspect / f;
      const ny = (1 - shipAnchor.y / height * 2) / f;
      const ray = normalize(forward.map((v, i) => v + right[i] * nx + up[i] * ny));
      if (ray[1] >= -.025 || shipAnchor.y < 0) drawShip = false;
      else {
        const distance = -eye[1] / ray[1];
        const position = eye.map((v, i) => v + ray[i] * distance);
        bx = position[0]; bz = position[2];
        const depth = dot(subtract(position, eye), forward);
        boatScale = shipAnchor.span * depth * 2 / (height * f * 7.5);
      }
    }
    if (drawShip) {
    const bob = Math.sin(bx * .34 + bz * .18 - t * .86) * .23 + Math.sin(t * 1.19) * .07;
    const model = matrix.boat(bx, bob + .12, bz, -.28 + px * .025, Math.sin(t * .86) * .025, Math.sin(t * .63) * .018, boatScale);
    useProgram(boat.id); gl.uniformMatrix4fv(boat.uniforms.uVP, false, vp); gl.uniformMatrix4fv(boat.uniforms.uModel, false, model);
    gl.uniform2f(boat.uniforms.uClipShift, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, flagTexture); gl.uniform1i(boat.uniforms.uFlag, 0);
    [[hullMesh, 0], [rearMesh, 0], [sailMesh, 1]].forEach(([mesh, textured]) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer); bindAttribute(boat.id, "aPosition", 3, 44, 0); bindAttribute(boat.id, "aNormal", 3, 44, 12); bindAttribute(boat.id, "aColor", 3, 44, 24); bindAttribute(boat.id, "aUv", 2, 44, 36);
      gl.uniform1f(boat.uniforms.uTextured, textured); gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    });
    }
    frame += 1;
    if (frame === 1) { root.classList.add("webgl-ocean-ready"); canvas.dataset.renderer = "webgl"; }
    if (frame === 1 || frame % 15 === 0) canvas.dataset.frameCount = String(frame);
  }
  function sailing() { return !lost && !document.hidden && root.dataset.seaMotion === "sailing"; }
  function tick(now) {
    request = 0;
    if (!sailing()) return;
    if (!previous) previous = now;
    elapsed += Math.min((now - previous) / 1000, .08); previous = now;
    if (now - lastPaint >= (mobile ? 1000 / 24 : 1000 / 30)) { draw(elapsed); lastPaint = now; }
    request = window.requestAnimationFrame(tick);
  }
  function sync() {
    if (request) window.cancelAnimationFrame(request);
    request = 0; previous = 0;
    if (sailing()) request = window.requestAnimationFrame(tick);
    else if (!lost && !document.hidden) draw(elapsed);
  }
  function resize() {
    const rect = canvas.getBoundingClientRect(); width = Math.max(rect.width, 1); height = Math.max(rect.height, 1); mobile = width < 801;
    cacheShipAnchor();
    const ratio = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5, Math.sqrt(2000000 / (width * height)));
    canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio)); draw(elapsed);
  }
  window.addEventListener("pointermove", event => { if (event.pointerType === "touch") return; tx = event.clientX / width * 2 - 1; ty = event.clientY / height * 2 - 1; }, { passive: true });
  document.addEventListener("pointerleave", () => { tx = 0; ty = 0; });
  window.addEventListener("scroll", () => {
    scrollTarget = Math.min(window.scrollY / Math.max(height, 1), 1);
    if (mobile) {
      cacheShipAnchor();
      if (!sailing() && !document.hidden) sync();
    }
  }, { passive: true });
  document.addEventListener("visibilitychange", sync);
  if (reduced.addEventListener) reduced.addEventListener("change", sync); else reduced.addListener(sync);
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-sea-motion"] });
  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault(); lost = true; if (request) window.cancelAnimationFrame(request); request = 0;
    root.classList.remove("webgl-ocean-ready"); canvas.dataset.renderer = "fallback";
  });
  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas); else window.addEventListener("resize", resize, { passive: true });
  resize(); sync();
})();
