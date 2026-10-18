/* Dependency-free WebGL seascape. The page owns the motion preference. */
(() => {
  "use strict";
  const canvas = document.getElementById("ocean-canvas");
  if (!canvas) return;
  const root = document.documentElement;
  const shipSpace = document.querySelector(".voyage-scene-space");
  let shipAnchor = null, canvasBounds = { left: 0, top: 0 };
  let gl;
  try { gl = canvas.getContext("webgl", { alpha: false, antialias: true, powerPreference: "low-power" }); } catch (_) { return; }
  if (!gl) return;

  let frame = 0, request = 0, previous = 0, elapsed = 0, lastPaint = 0, lost = false, inView = true;
  let width = 1, height = 1, mobile = false, scrollTarget = 0, scroll = 0;
  let px = 0, py = 0, tx = 0, ty = 0;
  let cinemaStarted = 0, cinemaOpen = false, drag = null;
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
  let sky, sea, boat, spray, birds, oceanMesh, hullMesh, sailMesh, rearMesh, faceMesh, flagTexture, faceTexture, skyBuffer, sprayBuffer, birdBuffer;
  try {
    sky = program("attribute vec2 aPosition;varying vec2 vUv;void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}", `
      varying vec2 vUv;uniform float uTime;uniform float uAspect;uniform vec2 uView;
      float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
      void main(){
        vec2 uv=vUv+uView;
        vec3 horizon=vec3(.85,.94,.93),upper=vec3(.44,.72,.86);
        vec3 color=mix(horizon,upper,smoothstep(.30,1.,uv.y));
        vec2 sun=uv-vec2(.82,.79);sun.x*=uAspect;
        float d=length(sun);
        color=mix(color,vec3(1.,.95,.80),exp(-d*7.)*.30);
        color+=vec3(.10,.075,.035)*exp(-d*d*95.);
        color=mix(color,vec3(1.,.98,.88),(1.-smoothstep(.015,.021,d))*.88);
        // Soft cloud masses have a broad shape and finer lit edges, drifting at
        // different speeds. Four noise samples avoid a heavy sky ray march.
        vec2 p=vec2(uv.x*uAspect*3.1+uTime*.012,uv.y*6.5);
        float billow=noise(p)*.64+noise(p*2.03+4.8)*.26+noise(p*4.09-8.2)*.10;
        float body=smoothstep(.49,.72,billow)*smoothstep(.43,.64,uv.y);
        vec3 cloudColor=mix(vec3(.81,.88,.89),vec3(1.,.99,.94),smoothstep(.50,.68,billow));
        color=mix(color,cloudColor,body*.82);
        float wisps=smoothstep(.54,.79,noise(vec2(uv.x*uAspect*2.4-uTime*.006,uv.y*20.)));
        wisps*=smoothstep(.67,.94,uv.y)*(1.-body)*.17;
        color=mix(color,vec3(.98,.99,.97),wisps);
        gl_FragColor=vec4(color,1.);
      }`, ["uTime", "uAspect", "uView"]);
    sea = program(`
      precision highp float;attribute vec3 aPosition;uniform mat4 uVP;uniform float uTime;
      varying vec3 vWorld;varying vec3 vNormal;varying float vHeight;
      void main(){
        vec2 p=aPosition.xz;
        float a=dot(p,vec2(.34,.18))-uTime*.86;
        float b=dot(p,vec2(-.19,.43))-uTime*1.19;
        float c=dot(p,vec2(.77,.55))+uTime*1.7;
        float h=sin(a)*.19+sin(b)*.085+sin(c)*.025;
        vec2 slope=cos(a)*vec2(.34,.18)*.19+cos(b)*vec2(-.19,.43)*.085+cos(c)*vec2(.77,.55)*.025;
        vWorld=vec3(p.x,h,p.y);vNormal=normalize(vec3(-slope.x,1.,-slope.y));vHeight=h;
        gl_Position=uVP*vec4(vWorld,1.);
      }`, `
      varying vec3 vWorld;varying vec3 vNormal;varying float vHeight;
      uniform vec3 uEye;uniform vec2 uResolution;uniform float uTime;
      uniform vec4 uShip;uniform float uShipVisible;
      float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
      void main(){
        float distanceToEye=length(vWorld.xz-uEye.xz);
        float nearDetail=1.-smoothstep(22.,90.,distanceToEye);
        vec2 p=vWorld.xz;
        float grain=noise(p*2.2+vec2(uTime*.18,-uTime*.31));
        float fine=noise(p*5.5+vec2(-uTime*.29,uTime*.16));
        vec2 ripple=vec2(sin(p.x*2.7+p.y*1.8-uTime*2.5),cos(p.y*3.2-p.x*1.3+uTime*1.9));
        ripple+=vec2(sin(p.x*6.8+p.y*4.1+uTime*3.6),cos(p.y*5.4-p.x*3.8-uTime*2.8))*.30;
        vec3 N=normalize(vNormal+vec3(ripple.x,0.,ripple.y)*(.035+fine*.035)*nearDetail);
        vec3 V=normalize(uEye-vWorld),L=normalize(vec3(.48,.34,-.82));
        float fresnel=pow(1.-max(dot(N,V),0.),3.);
        vec3 water=mix(vec3(.055,.38,.52),vec3(.18,.63,.68),clamp(vHeight+.55,0.,1.));
        water=mix(water,vec3(.64,.85,.87),fresnel*.72);
        water+=vec3(.015,.045,.037)*(grain-.5)*nearDetail;
        float reflected=max(dot(reflect(-L,N),V),0.);
        float sparkle=pow(reflected,160.)*(.25+.75*smoothstep(.35,.72,fine));
        float sunlight=pow(reflected,16.)*.15;
        water+=vec3(1.,.91,.68)*(sparkle*.80+sunlight);
        float crest=smoothstep(.235,.30,vHeight)*smoothstep(.48,.79,grain)*.24;
        // Inverse yaw keeps foam attached to the hull; +X is the stern. The
        // widening paired arms form a 19-degree wake without extra geometry.
        vec2 delta=(p-uShip.xy)/max(uShip.w,.05);
        float cy=cos(uShip.z),sy=sin(uShip.z);
        vec2 local=vec2(cy*delta.x-sy*delta.y,sy*delta.x+cy*delta.y);
        float trail=max(local.x-2.15,0.);
        float wakeWidth=.72+trail*.35;
        float edge=abs(local.y)-wakeWidth;
        float arms=exp(-edge*edge/(.045+trail*.025));
        float wakeGate=smoothstep(1.6,3.2,local.x)*(1.-smoothstep(11.,26.,trail));
        float wakeGrain=noise(local*vec2(2.4,4.2)-vec2(uTime*1.9,uTime*.12));
        float bands=.5+.5*sin(trail*5.2-uTime*3.5+local.y*1.8);
        float center=(1.-smoothstep(.15,wakeWidth,abs(local.y)))*exp(-trail*.21);
        float wake=(arms*(.35+.55*wakeGrain)+center*bands*.22)*wakeGate;
        float bowRadius=length(local/vec2(3.35,1.02));
        float bowEdge=(bowRadius-1.02)*16.;
        float bow=exp(-bowEdge*bowEdge)*(1.-smoothstep(-1.4,.5,local.x));
        bow*=.35+.55*grain;
        float shipFoam=clamp(wake*.68+bow*.80,0.,.86)*uShipVisible;
        float hullShadow=exp(-dot(local/vec2(2.5,.85),local/vec2(2.5,.85))*1.3)*.15*uShipVisible;
        water*=1.-hullShadow;
        water=mix(water,vec3(.88,.97,.95),clamp(crest+shipFoam,0.,.9));
        float fog=1.-exp(-max(distanceToEye-25.,0.)*.025);
        float mist=noise(p*vec2(.045,.08)+vec2(uTime*.016,-uTime*.009))*.65;
        mist+=noise(p*vec2(.12,.06)-vec2(uTime*.012,uTime*.006))*.35;
        mist=smoothstep(.38,.76,mist)*smoothstep(18.,60.,distanceToEye)*.14;
        water=mix(water,vec3(.72,.88,.88),clamp(fog*.90+mist,0.,.96));
        gl_FragColor=vec4(water,1.);
      }`, ["uVP", "uTime", "uEye", "uResolution", "uShip", "uShipVisible"]);
    boat = program(`
      precision highp float;attribute vec3 aPosition;attribute vec3 aNormal;attribute vec3 aColor;attribute vec2 aUv;
      uniform mat4 uVP;uniform mat4 uModel;uniform vec2 uClipShift;uniform float uTime;uniform float uCloth;
      varying vec3 vNormal;varying vec3 vColor;varying vec2 vUv;varying vec3 vWorld;varying float vHeight;
      void main(){
        vec3 local=aPosition;
        local.z+=uCloth*.055*sin(uTime*1.6+aUv.x*5.+aUv.y*2.)*sin(aUv.x*3.14159)*sin(aUv.y*3.14159);
        vec4 world=uModel*vec4(local,1.);vec4 p=uVP*world;p.xy+=uClipShift*p.w;gl_Position=p;
        vWorld=world.xyz;vHeight=local.y;vNormal=normalize(mat3(uModel)*aNormal);vColor=aColor;vUv=aUv;
      }
      `, `
      varying vec3 vNormal;varying vec3 vColor;varying vec2 vUv;varying vec3 vWorld;varying float vHeight;
      uniform sampler2D uFlag;uniform float uTextured;uniform float uCloth;uniform vec3 uEye;
      void main(){
        vec3 n=normalize(vNormal),lightDirection=normalize(vec3(-.45,.82,.65));
        float light=.62+.32*max(dot(n,lightDirection),0.)+.09*max(dot(n,normalize(vec3(.7,.3,-.5))),0.);
        light*=.92+.08*smoothstep(-.1,1.6,vHeight);
        vec4 decal=texture2D(uFlag,vUv);vec3 color=mix(vColor,decal.rgb,decal.a*uTextured);
        vec3 halfDirection=normalize(lightDirection+normalize(uEye-vWorld));
        float sheen=pow(max(dot(n,halfDirection),0.),44.)*.065*(1.-uCloth);
        gl_FragColor=vec4(color*light+vec3(1.,.89,.67)*sheen,1.);
      }
      `, ["uVP", "uModel", "uClipShift", "uFlag", "uTextured", "uTime", "uCloth", "uEye"]);
    // Small, world-space details convey scale as the camera moves through the sea.
    spray = program(`
      precision highp float;attribute vec4 aSeed;uniform mat4 uVP;uniform vec4 uShip;
      uniform float uTime;uniform float uPixelRatio;varying float vAlpha;
      void main(){
        float phase=fract(uTime*.24+aSeed.x), side=step(.5,aSeed.y)*2.-1.;
        float bow=step(.55,aSeed.w);
        float x=mix(2.9+phase*11.,-3.35+phase*2.3,bow);
        float z=side*(mix(.9+phase*2.3,.55+phase*.9,bow)+sin(aSeed.x*40.+phase*8.)*.12);
        float y=.09+sin(phase*3.14159)*(.15+aSeed.z*.65);
        float c=cos(uShip.z),s=sin(uShip.z);
        vec3 world=vec3(uShip.x+(c*x+s*z)*uShip.w,y*uShip.w,uShip.y+(-s*x+c*z)*uShip.w);
        vec4 clip=uVP*vec4(world,1.);gl_Position=clip;
        gl_PointSize=clamp((2.+aSeed.z*3.)*uPixelRatio*uShip.w*10./max(clip.w,1.),1.,6.);
        vAlpha=sin(phase*3.14159)*(1.-phase)*.65;
      }`, `
      varying float vAlpha;
      void main(){vec2 p=gl_PointCoord*2.-1.;float r=dot(p,p);if(r>1.)discard;
        gl_FragColor=vec4(.92,.99,1.,exp(-r*2.5)*vAlpha);
      }`, ["uVP","uShip","uTime","uPixelRatio"]);
    birds = program(`
      precision highp float;attribute vec3 aPosition;attribute vec4 aFlight;
      uniform mat4 uVP;uniform vec4 uShip;uniform float uTime;varying float vDepth;
      void main(){
        float phase=uTime*.12+aFlight.w*6.28318;
        vec3 local=aPosition;
        local.y+=abs(local.x)*sin(uTime*(3.1+aFlight.w)+aFlight.w*20.)*.42;
        vec3 center=aFlight.xyz+vec3(sin(phase)*4.,sin(phase*1.7)*.35,cos(phase)*3.);
        float angle=phase*.13;vec3 wing=vec3(cos(angle)*local.x+sin(angle)*local.z,local.y,-sin(angle)*local.x+cos(angle)*local.z);
        vec3 world=vec3(uShip.x,0.,uShip.y)+(center+wing)*uShip.w;
        vec4 clip=uVP*vec4(world,1.);gl_Position=clip;vDepth=clip.w/max(uShip.w,.01);
      }`, `
      varying float vDepth;
      void main(){float haze=smoothstep(15.,65.,vDepth);gl_FragColor=vec4(mix(vec3(.19,.36,.39),vec3(.65,.80,.81),haze),1.);}
      `, ["uVP","uShip","uTime"]);
    const seeds=[];for(let i=0;i<96;i+=1){seeds.push((i*.6180339)%1,(i*.7548776)%1,(i*.5698403)%1,(i*.438579)%1);}
    sprayBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,sprayBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(seeds),gl.STATIC_DRAW);
    const flock=[],wing=[[-.65,.02,-.05],[-.25,0,.16],[0,0,0],[0,0,0],[.25,0,.16],[.65,.02,-.05]];
    for(let i=0;i<12;i+=1){const seed=(i*.6180339)%1,flight=[-14+((i*.7548776)%1)*28,6+seed*3,-20-((i*.438579)%1)*26,seed];wing.forEach(v=>flock.push(...v,...flight));}
    birdBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,birdBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(flock),gl.STATIC_DRAW);
    skyBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, skyBuffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    oceanMesh = makeOcean();
    const shapes = makeBoat(); hullMesh = upload(shapes.hull); sailMesh = upload(shapes.main); rearMesh = upload(shapes.rear); faceMesh = upload(shapes.face);
    flagTexture = makeFlag(); faceTexture = makeLionFace();
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
    const hull = [], main = [], rear = [], face = [];
    const wood = [.62, .35, .18], darkWood = [.38, .20, .11], gold = [.95, .71, .32];
    const cream = [.99, .94, .81], ivory = [1, .98, .89], red = [.82, .25, .18];
    const ink = [.075, .15, .18], rope = [.63, .49, .30], glass = [.09, .34, .39];
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], TAU = Math.PI * 2;
    const shade = (color, amount) => color.map(n => Math.min(1, n * amount));
    const along = (origin, basis, p) => origin.map((n, i) => n + basis[0][i] * p[0] + basis[1][i] * p[1] + basis[2][i] * p[2]);
    function triangle(out, a, b, c, color, uv = [[0, 0], [1, 0], [1, 1]], normals) {
      const normal = normalize(cross(subtract(b, a), subtract(c, a)));
      [a, b, c].forEach((p, i) => out.push(...p, ...(normals ? normals[i] : normal), ...color, ...uv[i]));
    }
    function quad(out, a, b, c, d, color, uv, normals) {
      triangle(out, a, b, c, color, uv && [uv[0], uv[1], uv[2]], normals && [normals[0], normals[1], normals[2]]);
      triangle(out, a, c, d, color, uv && [uv[0], uv[2], uv[3]], normals && [normals[0], normals[2], normals[3]]);
    }
    function box(cx, cy, cz, sx, sy, sz, color) {
      const v = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(p => [cx+p[0]*sx/2,cy+p[1]*sy/2,cz+p[2]*sz/2]);
      [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]].forEach(f => quad(hull, ...f.map(i => v[i]), color));
    }
    function rod(a, b, radius, color, sides = 10, endRadius = radius, caps = true) {
      const direction = normalize(subtract(b, a));
      const u = normalize(cross(direction, Math.abs(direction[1]) > .9 ? [1,0,0] : [0,1,0]));
      const v = cross(direction, u), slope = (radius-endRadius) / (Math.hypot(...subtract(b,a)) || 1);
      const radial = angle => u.map((n,i) => n*Math.cos(angle)+v[i]*Math.sin(angle));
      const point = (center, r, angle) => center.map((n,i) => n+r*radial(angle)[i]);
      const normal = angle => normalize(radial(angle).map((n,i) => n+direction[i]*slope));
      for (let i=0;i<sides;i+=1) {
        const p=i/sides*TAU,q=(i+1)/sides*TAU, n=normal(p),N=normal(q);
        quad(hull,point(a,radius,p),point(b,endRadius,p),point(b,endRadius,q),point(a,radius,q),color,undefined,[n,n,N,N]);
        if (caps) {
          triangle(hull,b,point(b,endRadius,p),point(b,endRadius,q),color,undefined,[direction,direction,direction]);
          const back=direction.map(n=>-n);
          triangle(hull,a,point(a,radius,q),point(a,radius,p),color,undefined,[back,back,back]);
        }
      }
    }
    function path(points, radius, color, sides=6) {
      for(let i=1;i<points.length;i+=1)rod(points[i-1],points[i],radius,color,sides,radius,false);
    }
    function sphere(center,size,color,slices=20,bands=12,basis=axes) {
      const point=(a,b)=>along(center,basis,[Math.cos(a)*Math.sin(b)*size[0],Math.cos(b)*size[1],Math.sin(a)*Math.sin(b)*size[2]]);
      const normal=(a,b)=>normalize(along([0,0,0],basis,[Math.cos(a)*Math.sin(b)/size[0],Math.cos(b)/size[1],Math.sin(a)*Math.sin(b)/size[2]]));
      for(let i=0;i<slices;i+=1)for(let j=0;j<bands;j+=1){
        const a=i/slices*TAU,b=j/bands*Math.PI,c=(i+1)/slices*TAU,d=(j+1)/bands*Math.PI;
        quad(hull,point(a,b),point(c,b),point(c,d),point(a,d),color,undefined,[normal(a,b),normal(c,b),normal(c,d),normal(a,d)]);
      }
    }
    function ring(center,axis,radius,tube,color,segments=24,sides=6,start=0,end=TAU) {
      const u=normalize(cross(axis,Math.abs(axis[1])>.9?[1,0,0]:[0,1,0])),v=cross(axis,u);
      const radial=a=>u.map((n,i)=>n*Math.cos(a)+v[i]*Math.sin(a));
      const normal=(a,b)=>radial(a).map((n,i)=>n*Math.cos(b)+axis[i]*Math.sin(b));
      const point=(a,b)=>center.map((n,i)=>n+radial(a)[i]*radius+normal(a,b)[i]*tube);
      for(let i=0;i<segments;i+=1)for(let j=0;j<sides;j+=1){
        const a=start+(end-start)*i/segments,A=start+(end-start)*(i+1)/segments,b=j/sides*TAU,B=(j+1)/sides*TAU;
        quad(hull,point(a,b),point(A,b),point(A,B),point(a,B),color,undefined,[normal(a,b),normal(A,b),normal(A,B),normal(a,B)]);
      }
    }
    // A curved, planked hull with raised ends and the Sunny's red/ivory strakes.
    const sections=64;
    function hullPoint(a,y,scale=1){
      const c=Math.cos(a),s=Math.sin(a);
      return [c*(c<0?3.18:2.96)*scale,y+.18*Math.pow(Math.abs(c),6),s*1.16*scale];
    }
    const strakes=[[-.78,.45,wood],[-.52,.75,wood],[-.28,.91,shade(wood,1.10)],[-.04,1,wood],[.20,1.045,shade(wood,1.12)],[.39,1.055,red],[.66,1.04,red],[.87,1,ivory],[.98,.99,cream]];
    for(let r=1;r<strakes.length;r+=1)for(let i=0;i<sections;i+=1){
      const a=i/sections*TAU,A=(i+1)/sections*TAU,[y,s,col]=strakes[r],[by,bs]=strakes[r-1];
      const variation=.96+.07*Math.sin(i*1.83+r*3.17);
      const color=r<=4?shade(col,variation):col;
      const normal=t=>normalize([Math.cos(t)/3.1,.25,Math.sin(t)/1.16]);
      quad(hull,hullPoint(a,y,s),hullPoint(A,y,s),hullPoint(A,by,bs),hullPoint(a,by,bs),color,undefined,[normal(a),normal(A),normal(A),normal(a)]);
      if(r<=5)quad(hull,hullPoint(a,y-.012,s*1.001),hullPoint(A,y-.012,s*1.001),hullPoint(A,y+.006,s*1.001),hullPoint(a,y+.006,s*1.001),shade(color,.70));
    }
    function contour(y,scale,radius,color){path(Array.from({length:sections+1},(_,i)=>hullPoint(i/sections*TAU,y,scale)),radius,color);}
    contour(.36,1.058,.032,gold);contour(.86,1.006,.035,gold);contour(1.01,.99,.065,darkWood);
    // Individually jointed deck planks stop at the curved gunwale.
    for(let i=0;i<30;i+=1){
      const x=-3.06+i*.20,z=1.12*Math.sqrt(Math.max(0,1-Math.pow(x/(x<0?3.18:2.96),2)));
      box(x,.965,0,.188,.035,z*2,shade(cream,.84+.06*(i%3)));
      if(i%2===0)box(x,.986,z*.28,.008,.006,z*1.2,darkWood);
    }
    // A grass deck, brass stanchions, two continuous rails, and mooring cleats.
    box(-.23,1.0,0,2.45,.018,1.55,[.29,.46,.19]);
    contour(1.15,.975,.023,cream);contour(1.44,.975,.043,gold);
    for(let i=0;i<32;i+=1){const a=i/32*TAU;rod(hullPoint(a,1.02,.975),hullPoint(a,1.43,.975),.025,ivory,6);}
    [-2.3,2.2].forEach(x=>[-1,1].forEach(side=>{
      rod([x,1.06,side*.84],[x,1.21,side*.84],.055,ink,8);
      rod([x-.12,1.18,side*.84],[x+.12,1.18,side*.84],.035,gold,8);
    }));
    // Round dock hatches and brass-rimmed cannon ports on both sides.
    [-1,1].forEach(side=>{
      [-1.95,-.75,.55,1.75].forEach((x,i)=>{
        const z=side*1.16*Math.sqrt(1-x*x/11),axis=[0,0,side],y=.65;
        rod([x,y,z],[x,y,z+side*.04],.16,ink,16);
        ring([x,y,z+side*.055],axis,.158,.026,gold,20);
        if(i===0||i===2){rod([x,y,z],[x,y,z+side*.32],.079,ink,12,.095);ring([x,y,z+side*.32],axis,.085,.018,gold,16);}
        else{
          rod([x,y,z+side*.043],[x,y,z+side*.051],.127,glass,16);
          rod([x-.09,y,z+side*.06],[x+.09,y,z+side*.06],.014,gold,6);
        }
      });
      const center=[.10,.20,side*1.25];
      rod([center[0],center[1],center[2]-side*.04],center,.28,ivory,24);
      ring(center,[0,0,side],.265,.035,gold,24);
      rod([-.03,.20,side*1.29],[.23,.20,side*1.29],.025,ink,8);
      for(let i=0;i<8;i+=1){const a=i/8*TAU;sphere([.1+Math.cos(a)*.23,.2+Math.sin(a)*.23,side*1.29],[.022,.022,.014],gold,8,4);}
    });
    // Rounded two-storey stern cabin with fluted red eaves and framed windows.
    rod([1.93,1.0,0],[1.93,1.92,0],.78,cream,32,.78);
    ring([1.93,1.13,0],[0,1,0],.79,.05,red,32);
    rod([1.93,1.91,0],[1.93,2.13,0],.94,red,32,.70);
    ring([1.93,1.94,0],[0,1,0],.94,.035,gold,32);
    for(let i=0;i<16;i+=1){const a=i/16*TAU;rod([1.93+Math.cos(a)*.91,1.95,Math.sin(a)*.91],[1.93+Math.cos(a)*.70,2.14,Math.sin(a)*.70],.015,shade(red,.75),5);}
    rod([2.05,2.11,-.05],[2.05,2.63,-.05],.48,ivory,24);
    rod([2.05,2.62,-.05],[2.05,2.83,-.05],.59,red,24,.20);
    ring([2.05,2.64,-.05],[0,1,0],.59,.025,gold,24);
    sphere([2.05,2.85,-.05],[.075,.10,.075],gold,12,8);
    [0,.70,1.40,2.10,2.80,3.50,4.20,4.90,5.60].forEach(a=>{
      const n=[Math.cos(a),0,Math.sin(a)],p=[1.93+n[0]*.79,1.53,n[2]*.79];
      rod(p,p.map((v,i)=>v+n[i]*.035),.13,glass,16);
      ring(p.map((v,i)=>v+n[i]*.045),n,.14,.023,gold,20);
      rod([p[0],1.42,p[2]],[p[0],1.64,p[2]],.012,cream,6);
    });
    [-1,1].forEach(side=>{
      const p=[2.05,2.36,side*.445];
      box(p[0],p[1],p[2],.32,.27,.035,wood);
      box(p[0],p[1],p[2]+side*.024,.255,.21,.018,glass);
      box(p[0],p[1],p[2]+side*.038,.018,.21,.018,gold);
    });
    // Stair treads, hatch, barrels and a small working helm on the foredeck.
    for(let i=0;i<6;i+=1)box(.72+i*.11,1.03+i*.085,.72,.16,.075,.44,wood);
    box(-1.68,1.018,.15,.55,.035,.53,darkWood);
    for(let i=0;i<6;i+=1)box(-1.88+i*.08,1.04,.15,.025,.024,.46,gold);
    [[-2.1,1.18,-.43],[-1.58,1.17,-.65]].forEach(p=>{
      rod([p[0],1.0,p[2]],[p[0],1.37,p[2]],.16,wood,12,.145);
      [1.07,1.30].forEach(y=>ring([p[0],y,p[2]],[0,1,0],.159,.017,ink,12));
    });
    rod([-1.9,1.0,.55],[-1.9,1.62,.55],.055,wood,10);
    ring([-1.9,1.61,.61],[0,0,1],.22,.025,wood,24);
    for(let i=0;i<8;i+=1){const a=i/8*TAU;rod([-1.9,1.61,.61],[-1.9+Math.cos(a)*.29,1.61+Math.sin(a)*.29,.61],.015,gold,6);}
    sphere([-1.9,1.61,.63],[.065,.065,.028],gold,12,6);
    // Tangerine grove on a little stern balcony, with visible individual fruit.
    box(2.53,1.54,-.42,.79,.12,1.20,wood);
    [[2.45,-.80],[2.80,-.38],[2.48,.02]].forEach(([x,z],i)=>{
      rod([x,1.6,z],[x,2.17+i*.06,z],.035,wood,8);
      [[0,.08,0],[-.14,-.02,.02],[.13,0,.04],[0,-.03,-.13]].forEach(([dx,dy,dz],j)=>sphere([x+dx,2.23+dy+i*.06,z+dz],[.22,.22,.20],j%2?[.22,.43,.15]:[.32,.54,.19],12,7));
      for(let j=0;j<4;j+=1){const a=j/4*TAU+i;sphere([x+Math.cos(a)*.19,2.19+(j%2)*.13+i*.06,z+Math.sin(a)*.19],[.045,.047,.045],[1,.49,.09],8,5);}
    });
    // Stern exhaust, a rudder and a life ring give the back a finished profile.
    rod([2.78,.23,0],[3.24,.23,0],.31,wood,24,.36);
    ring([3.24,.23,0],[1,0,0],.34,.055,gold,24);
    rod([3.24,.23,0],[3.26,.23,0],.275,ink,24);
    box(2.91,-.36,0,.20,.83,.10,darkWood);
    ring([1.06,1.27,1.12],[0,0,1],.19,.055,ivory,24);
    for(let i=0;i<4;i+=1)ring([1.06,1.27,1.12],[0,0,1],.19,.057,red,3,6,i*Math.PI/2,i*Math.PI/2+.30);

    // A round sun-lion with ten swept, pointed rays. Facial linework is
    // printed onto a curved cap, keeping the simple Sunny expression crisp.
    const faceNormal=normalize([-.80,0,.60]),faceRight=[faceNormal[2],0,-faceNormal[0]];
    const faceAxes=[faceRight,[0,1,0],faceNormal],head=[-3.08,1.31,.06];
    const fp=p=>along(head,faceAxes,p);
    const faceSphere=(p,size,color,slices=20,bands=12)=>sphere(fp(p),size,color,slices,bands,faceAxes);
    // Crossbones sit behind the head and emerge diagonally between the rays.
    [[[-.87,-.80,-.22],[.87,.80,-.22]],[[-.87,.80,-.22],[.87,-.80,-.22]]].forEach(([a,b])=>{
      rod(fp(a),fp(b),.065,ivory,10);
      [a,b].forEach(p=>[-1,1].forEach(side=>faceSphere([p[0]+side*.052,p[1]-side*.047,p[2]],[.087,.087,.065],ivory,12,8)));
    });
    faceSphere([0,0,-.10],[.64,.64,.20],[.94,.57,.16],32,16);
    for(let i=0;i<10;i+=1){
      const angle=i/10*TAU;
      const point=(t,u,back=false)=>{
        const r=.48+.64*t,a=angle+.08+.30*t*t;
        const half=.205*Math.pow(Math.max(0,Math.sin(Math.PI*(.20+.80*t))),.85);
        return [Math.sin(a)*r+Math.cos(a)*half*u,Math.cos(a)*r-Math.sin(a)*half*u,
          back?-.20:-.075+.10*Math.sin((u+1)*Math.PI/2)*Math.sin(t*Math.PI)+.035*t];
      };
      const normal=(t,u)=>{
        const dt=subtract(point(Math.min(1,t+.001),u),point(Math.max(0,t-.001),u));
        const du=subtract(point(t,Math.min(1,u+.001)),point(t,Math.max(-1,u-.001)));
        const n=cross(du,dt);
        return Math.hypot(...n)<.00000001?faceNormal:normalize(along([0,0,0],faceAxes,n));
      };
      const color=i%2?[.98,.43,.10]:[1,.53,.13];
      for(let j=0;j<14;j+=1)for(let k=0;k<6;k+=1){
        const t=j/14,T=(j+1)/14,u=k/3-1,U=(k+1)/3-1;
        quad(hull,fp(point(t,u)),fp(point(t,U)),fp(point(T,U)),fp(point(T,u)),color,undefined,[normal(t,u),normal(t,U),normal(T,U),normal(T,u)]);
      }
      // Narrow darker edge surfaces make each flame a solid sculpted piece.
      [-1,1].forEach(u=>{
        for(let j=0;j<14;j+=1){const t=j/14,T=(j+1)/14;
          quad(hull,fp(point(t,u)),fp(point(T,u)),fp(point(T,u,true)),fp(point(t,u,true)),[.79,.31,.07]);
        }
      });
    }
    faceSphere([0,0,-.02],[.615,.615,.21],[.97,.81,.42],32,16);
    const facePoint=(r,a)=>fp([Math.cos(a)*r*.60,Math.sin(a)*r*.60,.12+.27*Math.sqrt(Math.max(0,1-r*r))]);
    const faceNormalAt=(r,a)=>normalize(along([0,0,0],faceAxes,[Math.cos(a)*r/.60,Math.sin(a)*r/.60,Math.sqrt(Math.max(0,1-r*r))/.27]));
    const faceUV=(r,a)=>[.5+Math.cos(a)*r*.5,.5+Math.sin(a)*r*.5];
    for(let i=0;i<64;i+=1)for(let j=0;j<20;j+=1){
      const a=i/64*TAU,A=(i+1)/64*TAU,r=j/20,R=(j+1)/20;
      quad(face,facePoint(r,a),facePoint(R,a),facePoint(R,A),facePoint(r,A),[1,1,1],
        [faceUV(r,a),faceUV(R,a),faceUV(R,A),faceUV(r,A)],
        [faceNormalAt(r,a),faceNormalAt(R,a),faceNormalAt(R,A),faceNormalAt(r,A)]);
    }
    rod([-2.70,1.14,-.1],[-4.0,1.62,-.1],.055,wood,12,.025);
    path([[-4,1.62,-.1],[-3.5,.56,-.05],[-2.65,.4,0]],.018,rope);

    // Tapered masts, brass bindings, yardarms and a proper lookout basket.
    rod([-.72,.98,0],[-.72,6.50,0],.11,wood,16,.048);
    rod([1.52,1.05,-.12],[1.52,4.98,-.12],.073,wood,12,.035);
    for(let y=1.3;y<6;y+=.65)ring([-.72,y,0],[0,1,0],.097-y*.006,.012,gold,12);
    rod([-2.94,5.49,.04],[1.50,5.49,.04],.065,wood,12,.055);
    rod([.15,4.50,-.06],[2.89,4.50,-.06],.049,wood,10);
    rod([-.72,5.77,0],[-.72,5.99,0],.29,wood,24,.36);
    ring([-.72,5.99,0],[0,1,0],.36,.045,gold,24);
    ring([-.72,6.17,0],[0,1,0],.36,.025,cream,24);
    for(let i=0;i<10;i+=1){const a=i/10*TAU;rod([-.72+Math.cos(a)*.35,5.97,Math.sin(a)*.35],[-.72+Math.cos(a)*.35,6.17,Math.sin(a)*.35],.015,cream,5);}
    // Standing rigging and ratlines are behind the billowing cloth.
    path([[-4.0,1.62,-.1],[-.72,6.31,-.12],[2.90,1.30,-.35]],.017,rope);
    [-1,1].forEach(side=>{
      const top=[-.72,5.75,-.10],left=[-1.75,1.10,side*.98],right=[.34,1.10,side*.98];
      [left,right,[-.72,1.10,side*1.04]].forEach(p=>rod(p,top,.013,rope,5));
      for(let i=1;i<14;i+=1){const f=i/15;path([left.map((v,j)=>v+(top[j]-v)*f),right.map((v,j)=>v+(top[j]-v)*f)],.0085,rope,4);}
      rod([1.52,4.91,-.12],[2.65,1.34,side*.67],.013,rope,5);
    });
    function sail(out,center,bottom,top,halfWidth,striped,zOffset=0){
      const columns=24,rows=18;
      function point(u,v){return[center+(u-.5)*halfWidth*2*(.82+.18*v),bottom+v*(top-bottom)-.11*Math.sin(u*Math.PI),zOffset+.15+.66*Math.sin(u*Math.PI)*Math.sin(v*Math.PI)];}
      function normal(u,v){return normalize(cross([2*halfWidth*(.82+.18*v),-.11*Math.PI*Math.cos(u*Math.PI),.66*Math.PI*Math.cos(u*Math.PI)*Math.sin(v*Math.PI)],[(u-.5)*halfWidth*.36,top-bottom,.66*Math.PI*Math.sin(u*Math.PI)*Math.cos(v*Math.PI)]));}
      for(let i=0;i<columns;i+=1)for(let j=0;j<rows;j+=1){
        const u=i/columns,v=j/rows,U=(i+1)/columns,V=(j+1)/rows;
        quad(out,point(u,v),point(U,v),point(U,V),point(u,V),striped&&Math.floor(i/4)%2===0?red:cream,[[u,v],[U,v],[U,V],[u,V]],[normal(u,v),normal(U,v),normal(U,V),normal(u,V)]);
      }
      [0,1].forEach(u=>path(Array.from({length:19},(_,j)=>point(u,j/18)),.018,rope));
      [0,1].forEach(v=>path(Array.from({length:25},(_,i)=>point(i/24,v)),.020,rope));
      for(let i=0;i<=12;i+=1){const p=point(i/12,1);rod([p[0],top+.06,p[2]],p,.012,rope,5);}
      return point;
    }
    sail(main,-.72,2.05,5.43,2.13,false);
    sail(rear,1.52,2.95,4.44,1.31,true,-.17);
    // The small pirate pennant uses the same printed emblem as the main sail.
    const flagPoint=(u,v)=>[-.72+u*1.05,6.06+v*.46-.055*Math.sin(u*Math.PI),.04+.09*Math.sin(u*5)];
    for(let i=0;i<12;i+=1)for(let j=0;j<4;j+=1){const u=i/12,U=(i+1)/12,v=j/4,V=(j+1)/4;quad(main,flagPoint(u,v),flagPoint(U,v),flagPoint(U,V),flagPoint(u,V),ink,[[u,v],[U,v],[U,V],[u,V]]);}
    canvas.dataset.shipTriangles=String((hull.length+main.length+rear.length+face.length)/33);
    return {hull,main,rear,face};
  }
  function upload(vertices) {
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    return { buffer, count: vertices.length / 11 };
  }
  function makeLionFace() {
    const image=document.createElement("canvas");image.width=512;image.height=512;
    const c=image.getContext("2d");
    if(c){
      c.fillStyle="#f5d77e";c.fillRect(0,0,512,512);
      // Canonical, graphic features: round eyes, one round pale muzzle and a
      // generous smile. No brows, eye glints, cheek bulbs or realistic snout.
      c.lineCap="round";c.lineJoin="round";
      c.fillStyle="#fff6d7";c.strokeStyle="#8a542e";c.lineWidth=3.2;
      c.beginPath();c.ellipse(256,311,101,99,0,0,Math.PI*2);c.fill();c.stroke();
      [164,348].forEach(x=>{
        c.fillStyle="#fff6d7";c.beginPath();c.arc(x,185,34,0,Math.PI*2);c.fill();
        c.fillStyle="#342d24";c.beginPath();c.arc(x,185,27,0,Math.PI*2);c.fill();
        c.strokeStyle="#8a542e";c.lineWidth=2.5;c.beginPath();c.arc(x,185,34,0,Math.PI*2);c.stroke();
      });
      c.fillStyle="#79502e";
      c.beginPath();c.moveTo(235,242);c.quadraticCurveTo(256,229,277,242);
      c.quadraticCurveTo(273,259,256,271);c.quadraticCurveTo(239,258,235,242);c.fill();
      c.strokeStyle="#59432d";c.lineWidth=5.5;
      c.beginPath();c.moveTo(184,322);c.bezierCurveTo(214,389,298,389,328,322);c.stroke();
    }
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    return texture;
  }
  function makeFlag() {
    const image = document.createElement("canvas");
    image.width = 512; image.height = 512;
    const c = image.getContext("2d");
    if (c) {
      // The fabric stays translucent: the sail's cream vertex material supplies
      // its base colour, and this atlas adds stitching and the printed emblem.
      const wash = c.createLinearGradient(0, 0, 512, 512);
      wash.addColorStop(0, "rgba(255,250,224,.055)");
      wash.addColorStop(.48, "rgba(255,250,224,0)");
      wash.addColorStop(1, "rgba(113,80,40,.035)");
      c.fillStyle = wash; c.fillRect(0, 0, 512, 512);
      c.lineWidth = .65;
      for (let i = 2; i < 512; i += 4) {
        c.strokeStyle = i % 12 === 2 ? "rgba(118,91,49,.045)" : "rgba(255,248,218,.035)";
        c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 512); c.stroke();
        c.strokeStyle = "rgba(118,91,49,.025)";
        c.beginPath(); c.moveTo(0, i); c.lineTo(512, i); c.stroke();
      }
      c.strokeStyle = "rgba(121,91,49,.17)"; c.lineWidth = 2;
      c.strokeRect(12, 12, 488, 488);
      c.strokeStyle = "rgba(255,249,220,.27)"; c.lineWidth = 1;
      c.strokeRect(16, 16, 480, 480);
      c.strokeStyle = "rgba(116,86,46,.22)"; c.lineWidth = 1.1;
      for (let i = 24; i <= 488; i += 9) {
        c.beginPath();
        c.moveTo(i - 2, 9); c.lineTo(i + 2, 16);
        c.moveTo(i - 2, 496); c.lineTo(i + 2, 503);
        c.moveTo(9, i - 2); c.lineTo(16, i + 2);
        c.moveTo(496, i - 2); c.lineTo(503, i + 2);
        c.stroke();
      }
      c.strokeStyle = "rgba(122,94,54,.11)"; c.lineWidth = 1.2;
      [128, 256, 384].forEach(x => {
        c.beginPath(); c.moveTo(x, 18); c.lineTo(x, 494); c.stroke();
        c.strokeStyle = "rgba(255,249,225,.20)";
        c.beginPath(); c.moveTo(x + 2, 18); c.lineTo(x + 2, 494); c.stroke();
        c.strokeStyle = "rgba(122,94,54,.11)";
      });

      c.save(); c.translate(256, 290);
      c.lineJoin = "round"; c.lineCap = "round";
      const ink = "#223735", ivory = "#fff7dc";
      function bone(angle) {
        c.save(); c.translate(0, 15); c.rotate(angle);
        c.fillStyle = ivory; c.strokeStyle = ink; c.lineWidth = 5;
        c.beginPath();
        c.moveTo(-132, -9); c.lineTo(132, -9);
        c.bezierCurveTo(136, -26, 158, -28, 163, -13);
        c.bezierCurveTo(171, -6, 166, 0, 160, 3);
        c.bezierCurveTo(174, 15, 157, 30, 143, 21);
        c.quadraticCurveTo(135, 17, 132, 9); c.lineTo(-132, 9);
        c.bezierCurveTo(-138, 27, -159, 27, -164, 13);
        c.quadraticCurveTo(-169, 4, -160, -3);
        c.bezierCurveTo(-173, -15, -158, -29, -145, -22);
        c.quadraticCurveTo(-135, -18, -132, -9);
        c.closePath(); c.fill(); c.stroke();
        c.strokeStyle = "rgba(136,109,65,.32)"; c.lineWidth = 2;
        c.beginPath(); c.moveTo(-124, 4); c.lineTo(126, 4); c.stroke();
        c.restore();
      }
      bone(.57); bone(-.57);

      // One continuous silhouette keeps the round cranium and grin readable at
      // small sizes, while the asymmetric sockets give the printed mark life.
      c.fillStyle = ivory; c.strokeStyle = ink; c.lineWidth = 5.8;
      c.beginPath(); c.moveTo(-53, 24);
      c.bezierCurveTo(-86, 10, -94, -37, -72, -67);
      c.bezierCurveTo(-43, -108, 42, -108, 72, -67);
      c.bezierCurveTo(95, -36, 86, 10, 53, 24);
      c.lineTo(51, 65); c.quadraticCurveTo(0, 98, -51, 65);
      c.closePath(); c.fill(); c.stroke();
      c.fillStyle = ink;
      [[-30, -.14], [30, .14]].forEach(([x, angle]) => {
        c.beginPath(); c.ellipse(x, -20, 19, 23, angle, 0, Math.PI * 2); c.fill();
      });
      c.beginPath(); c.moveTo(0, 9); c.lineTo(-10, 28);
      c.quadraticCurveTo(0, 23, 10, 28); c.closePath(); c.fill();
      c.strokeStyle = ink; c.lineWidth = 4;
      c.beginPath(); c.moveTo(-51, 34); c.quadraticCurveTo(0, 53, 51, 34); c.stroke();
      c.beginPath(); c.moveTo(-51, 58); c.quadraticCurveTo(0, 83, 51, 58); c.stroke();
      [-31, -10, 10, 31].forEach(x => {
        const edge = Math.abs(x) / 51;
        c.beginPath(); c.moveTo(x, 42 - 5 * edge);
        c.lineTo(x, 78 - 11 * edge); c.stroke();
      });

      // Straw brim, rounded crown, woven strokes and a vermilion hat band.
      c.strokeStyle = ink; c.lineWidth = 5;
      const straw = c.createLinearGradient(0, -155, 0, -67);
      straw.addColorStop(0, "#eed18b"); straw.addColorStop(1, "#c89c4b");
      c.fillStyle = straw;
      c.beginPath(); c.ellipse(0, -81, 112, 24, -.035, 0, Math.PI * 2); c.fill(); c.stroke();
      c.save();
      c.beginPath(); c.ellipse(0, -81, 108, 21, -.035, 0, Math.PI * 2); c.clip();
      c.strokeStyle = "rgba(112,76,30,.34)"; c.lineWidth = 1.6;
      for (let x = -104; x <= 104; x += 11) {
        c.beginPath(); c.moveTo(x, -98); c.lineTo(x + 9, -64); c.stroke();
      }
      c.beginPath(); c.ellipse(0, -80, 101, 15, -.035, 0, Math.PI * 2); c.stroke();
      c.restore();
      c.fillStyle = straw; c.strokeStyle = ink; c.lineWidth = 5;
      c.beginPath(); c.moveTo(-66, -86);
      c.bezierCurveTo(-65, -129, -45, -154, 0, -154);
      c.bezierCurveTo(47, -154, 65, -130, 66, -86);
      c.quadraticCurveTo(0, -67, -66, -86); c.closePath(); c.fill(); c.stroke();
      c.save(); c.clip();
      c.strokeStyle = "rgba(126,86,34,.33)"; c.lineWidth = 1.5;
      for (let x = -57; x <= 57; x += 11) {
        c.beginPath(); c.moveTo(x * .72, -149);
        c.quadraticCurveTo(x, -128, x * 1.13, -91); c.stroke();
      }
      [-137, -125, -113].forEach(y => {
        c.beginPath(); c.moveTo(-65, y);
        c.quadraticCurveTo(0, y + 10, 65, y); c.stroke();
      });
      c.restore();
      c.fillStyle = "#be4933"; c.strokeStyle = "#8e372b"; c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(-65, -104);
      c.quadraticCurveTo(0, -86, 65, -104); c.lineTo(66, -88);
      c.quadraticCurveTo(0, -69, -66, -88); c.closePath(); c.fill(); c.stroke();
      c.strokeStyle = "rgba(255,214,155,.44)"; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(-59, -101); c.quadraticCurveTo(0, -87, 59, -101); c.stroke();
      c.restore();
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
    const canvasRect = canvas.getBoundingClientRect();
    canvasBounds = { left: canvasRect.left, top: canvasRect.top };
    if (!shipSpace) { shipAnchor = null; return; }
    const rect = shipSpace.getBoundingClientRect();
    const span = Math.min(rect.width * .90, Math.max(80, rect.height - 105) * 1.04);
    shipAnchor = {
      x: rect.left - canvasRect.left + rect.width * .5 + span * .025,
      y: rect.bottom - canvasRect.top - (width <= 560 ? 120 : 90),
      span,
    };
  }
  function draw(t) {
    if (lost) return;
    const aspect = width / height, cinematic = root.dataset.cinema === "open";
    px += (tx - px) * .035; py += (ty - py) * .035; scroll += (scrollTarget - scroll) * .03;
    const filmTime = Math.max(0, t - cinemaStarted);
    const orbit = -.68 + Math.sin(filmTime * .052) * .58 + px * .2;
    const radius = (mobile ? 20.5 : 14.5) + Math.cos(filmTime * .071) * 2.4;
    const eye = cinematic
      ? [Math.sin(orbit) * radius, 5.3 + Math.sin(filmTime * .09 + .3) * 1.1 - py * .65, Math.cos(orbit) * radius]
      : [px * .42 + Math.sin(t * .23) * .13, mobile ? 7.2 : 6.4 + Math.sin(t * .31) * .11, mobile ? 21 : 18];
    const target = cinematic ? [0, 2.5 + Math.sin(filmTime * .045) * .18, 0] : [px * .3, -.1 + py * .15 - scroll * .1, -24];
    const vp = matrix.multiply(matrix.perspective(aspect), matrix.look(eye, target));
    let bx = 0, bz = 0, boatScale = 1, drawShip = cinematic || Boolean(shipAnchor);
    const yaw = .30 + px * (cinematic ? .025 : .05) + Math.sin(t * .12) * .025;
    if (!cinematic && shipAnchor) {
      // Intersect the hero composition anchor with the actual sea plane.
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
        const breath = .985 + Math.sin(t * .09) * .015;
        boatScale = shipAnchor.span * depth * 2 / (height * f * 7.7) * breath;
      }
    }
    const ship = new Float32Array([bx, bz, yaw, boatScale]);
    gl.viewport(0, 0, canvas.width, canvas.height); gl.disable(gl.BLEND); gl.depthMask(true); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    useProgram(sky.id); gl.bindBuffer(gl.ARRAY_BUFFER, skyBuffer); bindAttribute(sky.id, "aPosition", 2);
    gl.uniform1f(sky.uniforms.uTime, t); gl.uniform1f(sky.uniforms.uAspect, aspect);
    gl.uniform2f(sky.uniforms.uView, cinematic ? Math.sin(orbit) * .045 : px * .009, cinematic ? (eye[1] - 5) * .008 : py * .004);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT);
    useProgram(sea.id); gl.bindBuffer(gl.ARRAY_BUFFER, oceanMesh.position); bindAttribute(sea.id, "aPosition", 3);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, oceanMesh.index); gl.uniformMatrix4fv(sea.uniforms.uVP, false, vp);
    gl.uniform1f(sea.uniforms.uTime, t); gl.uniform3fv(sea.uniforms.uEye, eye); gl.uniform2f(sea.uniforms.uResolution, canvas.width, canvas.height);
    gl.uniform4fv(sea.uniforms.uShip, ship); gl.uniform1f(sea.uniforms.uShipVisible, drawShip ? 1 : 0);
    gl.drawElements(gl.TRIANGLES, oceanMesh.count, gl.UNSIGNED_SHORT, 0);
    if (drawShip) {
      const bob = Math.sin(bx * .34 + bz * .18 - t * .86) * .19
        + Math.sin(bx * -.19 + bz * .43 - t * 1.19) * .085
        + Math.sin(bx * .77 + bz * .55 + t * 1.7) * .025;
      const model = matrix.boat(bx, bob + .045, bz, yaw, Math.sin(t * .86) * .018, Math.sin(t * .63) * .012, boatScale);
      useProgram(boat.id); gl.uniformMatrix4fv(boat.uniforms.uVP, false, vp); gl.uniformMatrix4fv(boat.uniforms.uModel, false, model);
      gl.uniform2f(boat.uniforms.uClipShift, 0, 0); gl.uniform1f(boat.uniforms.uTime, t); gl.uniform3fv(boat.uniforms.uEye, eye);
      gl.activeTexture(gl.TEXTURE0); gl.uniform1i(boat.uniforms.uFlag, 0);
      [[hullMesh, 0, 0, flagTexture], [rearMesh, 0, 1, flagTexture], [sailMesh, 1, 1, flagTexture], [faceMesh, 1, 0, faceTexture]].forEach(([mesh, textured, cloth, texture]) => {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer); bindAttribute(boat.id, "aPosition", 3, 44, 0); bindAttribute(boat.id, "aNormal", 3, 44, 12); bindAttribute(boat.id, "aColor", 3, 44, 24); bindAttribute(boat.id, "aUv", 2, 44, 36);
        gl.uniform1f(boat.uniforms.uTextured, textured); gl.uniform1f(boat.uniforms.uCloth, cloth); gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      });
      useProgram(birds.id);gl.bindBuffer(gl.ARRAY_BUFFER,birdBuffer);bindAttribute(birds.id,"aPosition",3,28,0);bindAttribute(birds.id,"aFlight",4,28,12);
      gl.uniformMatrix4fv(birds.uniforms.uVP,false,vp);gl.uniform4fv(birds.uniforms.uShip,ship);gl.uniform1f(birds.uniforms.uTime,t);gl.drawArrays(gl.TRIANGLES,0,mobile ? 42 : 72);
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
      useProgram(spray.id);gl.bindBuffer(gl.ARRAY_BUFFER,sprayBuffer);bindAttribute(spray.id,"aSeed",4);
      gl.uniformMatrix4fv(spray.uniforms.uVP,false,vp);gl.uniform4fv(spray.uniforms.uShip,ship);gl.uniform1f(spray.uniforms.uTime,t);gl.uniform1f(spray.uniforms.uPixelRatio,canvas.width/width);gl.drawArrays(gl.POINTS,0,mobile ? 48 : 96);
      gl.depthMask(true);gl.disable(gl.BLEND);
    }
    frame += 1;
    if (frame === 1) { root.classList.add("webgl-ocean-ready"); canvas.dataset.renderer = "webgl"; }
    if (frame === 1 || frame % 15 === 0) canvas.dataset.frameCount = String(frame);
  }
  function sailing() { return !lost && inView && !document.hidden && root.dataset.seaMotion === "sailing"; }
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
    else if (!lost && inView && !document.hidden) draw(elapsed);
  }
  function resize() {
    const rect = canvas.getBoundingClientRect(); width = Math.max(rect.width, 1); height = Math.max(rect.height, 1); mobile = width < 801;
    cacheShipAnchor();
    const ratio = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5, Math.sqrt(2000000 / (width * height)));
    canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio)); draw(elapsed);
  }
  window.addEventListener("pointermove", event => {
    if (event.pointerType === "touch") return;
    const x = event.clientX - canvasBounds.left, y = event.clientY - canvasBounds.top;
    if (x < 0 || x > width || y < 0 || y > height) { tx = 0; ty = 0; return; }
    tx = x / width * 2 - 1; ty = y / height * 2 - 1;
  }, { passive: true });
  document.addEventListener("pointerleave", () => { tx = 0; ty = 0; });
  window.addEventListener("scroll", () => {
    scrollTarget = Math.min(window.scrollY / Math.max(height, 1), 1);
    cacheShipAnchor();
    if (!sailing() && !document.hidden) sync();
  }, { passive: true });
  document.addEventListener("visibilitychange", sync);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(entries => {
      inView = entries[0].isIntersecting;
      sync();
    }, { rootMargin: "80px" }).observe(canvas);
  }
  if (reduced.addEventListener) reduced.addEventListener("change", sync); else reduced.addListener(sync);
  new MutationObserver(() => {
    const open = root.dataset.cinema === "open";
    if (open !== cinemaOpen) {
      cinemaOpen = open; cinemaStarted = elapsed; tx = 0; ty = 0; px = 0; py = 0; drag = null;
      inView = open || canvas.getBoundingClientRect().bottom > 0;
      resize();
    }
    sync();
  }).observe(root, { attributes: true, attributeFilter: ["data-sea-motion", "data-cinema"] });
  canvas.addEventListener("pointerdown", event => {
    if (!cinemaOpen || event.pointerType === "mouse") return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, tx, ty };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    tx = Math.max(-1, Math.min(1, drag.tx + (event.clientX - drag.x) / Math.max(width * .3, 1)));
    ty = Math.max(-1, Math.min(1, drag.ty + (event.clientY - drag.y) / Math.max(height * .3, 1)));
    if (!sailing()) { px = tx; py = ty; draw(elapsed); }
  }, { passive: true });
  const releaseDrag = () => { drag = null; };
  canvas.addEventListener("pointerup", releaseDrag); canvas.addEventListener("pointercancel", releaseDrag);
  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault(); lost = true; if (request) window.cancelAnimationFrame(request); request = 0;
    root.classList.remove("webgl-ocean-ready"); canvas.dataset.renderer = "fallback";
  });
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    if (shipSpace) observer.observe(shipSpace);
  } else window.addEventListener("resize", resize, { passive: true });
  resize(); sync();
})();
