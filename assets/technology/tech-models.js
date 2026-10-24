/* Discovered Technology — the 3D recipes.
 *
 * Every entry in Reputation-Matrix2/data/technology.json names a `model.recipe`
 * and a `model.palette`. A recipe is a function that returns a list of parts
 * (boxes, cylinders, spheres, tori, lathes, prisms, groups) built with the
 * helpers below; tech-gl.js turns the list into a shaded, turnable model with
 * no library and no network. Palette keys ('body', 'brass', …) resolve to the
 * entry's colours, so one recipe can serve several entries (the two radios)
 * and a new piece of technology can be filed by picking the nearest recipe and
 * giving it a palette — or by adding a recipe here.
 *
 * The models are read off the filings: the helicopter has the searchlight that
 * "was not sweeping the valley", the belly hatch the claw dropped from and the
 * yellow light the fired pilot knew about; the claw is yellow-and-black with the
 * W on its housing and the smaller pincer beside it; the cannon has a Bullet
 * Bill in the muzzle because that is what it fires; the survey machine has the
 * flower that fixed it. tools/render-tech-models.mjs renders all of them to PNG
 * with the site's own rasteriser so they can be looked at without a browser.
 *
 * Classic script: index.html and the node tools both `new Function` it.
 * tools/check-technology.py reads recipe names from lines matching `T.<name> =`.
 */
(function(){
  'use strict';

  const T = {};                       // recipe name -> (palette) -> parts[]
  const PI = Math.PI, X = PI/2;

  /* ---------- part helpers ---------- */
  const box  = (w,h,d,p,c,x)=>Object.assign({s:'box', d:[w,h,d], p, c}, x||{});
  const cyl  = (rt,rb,h,p,c,x)=>Object.assign({s:'cyl', d:[rt,rb,h,(x&&x.seg)||24], p, c}, x||{});
  const cone = (r,h,p,c,x)=>Object.assign({s:'cyl', d:[0,r,h,(x&&x.seg)||24], p, c}, x||{});
  const sph  = (r,p,c,x)=>Object.assign({s:'sph', d:[r,(x&&x.seg)||20,(x&&x.rings)||12], p, c}, x||{});
  const tor  = (R,t,p,c,x)=>Object.assign({s:'torus', d:[R,t,(x&&x.rings)||10,(x&&x.seg)||32], p, c}, x||{});
  const lathe= (pts,p,c,x)=>Object.assign({s:'lathe', d:[pts,(x&&x.seg)||28], p, c}, x||{});
  const grp  = (p,r,parts,x)=>Object.assign({p:p||[0,0,0], r:r||null, parts}, x||{});
  /* convex polygon in the XY plane extruded along Z; orientation is fixed up automatically */
  const prism= (pts,depth,p,c,x)=>{
    let area=0; for(let i=0;i<pts.length;i++){ const a=pts[i], b=pts[(i+1)%pts.length]; area += a[0]*b[1]-b[0]*a[1]; }
    return Object.assign({s:'prism', d:[area<0 ? pts.slice().reverse() : pts, depth], p, c}, x||{});
  };
  /* a box running from 2D point a to b in the XY plane (inside a group) */
  const bar2 = (a,b,t,c,x)=>{ const dx=b[0]-a[0], dy=b[1]-a[1]; return box(t, Math.hypot(dx,dy), (x&&x.depth)||t, [(a[0]+b[0])/2,(a[1]+b[1])/2,(x&&x.z)||0], c, Object.assign({r:[0,0,Math.atan2(-dx,dy)]}, x||{})); };
  /* a cylinder from 3D point a to b (radius r at a, x.r2 at b) via an explicit matrix */
  const norm3 = (v)=>{ const l=Math.hypot(v[0],v[1],v[2])||1; return [v[0]/l,v[1]/l,v[2]/l]; };
  const cross3 = (a,b)=>[a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const bar3 = (a,b,r,c,x)=>{
    const d=[b[0]-a[0],b[1]-a[1],b[2]-a[2]]; const L=Math.hypot(d[0],d[1],d[2])||1e-6; const y=[d[0]/L,d[1]/L,d[2]/L];
    const ref = Math.abs(y[1])<0.9 ? [0,1,0] : [1,0,0]; const xa=norm3(cross3(ref,y)); const za=cross3(xa,y);
    const m=[xa[0],xa[1],xa[2],0, y[0],y[1],y[2],0, za[0],za[1],za[2],0, (a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2,1];
    return Object.assign({s:'cyl', d:[(x&&x.r2!=null)?x.r2:r, r, L, (x&&x.seg)||12], m, c}, x||{});
  };
  /* a tube through 3D points: segments with sphere joints (x.joints:false to skip) */
  const tube = (pts,r,c,x)=>{ const parts=[]; for(let i=0;i<pts.length-1;i++){ parts.push(bar3(pts[i],pts[i+1],r,c,x)); if(i>0 && !(x&&x.joints===false)) parts.push(sph(r,pts[i],c,{seg:10,rings:6})); } return grp([0,0,0],null,parts); };
  const helix = (c,R,h,turns,n)=>{ const pts=[]; for(let i=0;i<=n;i++){ const t=i/n, a=t*turns*PI*2; pts.push([c[0]+R*Math.sin(a), c[1]-h/2+t*h, c[2]+R*Math.cos(a)]); } return pts; };
  /* a cog with its axis along Y */
  const gear = (R,n,th,c,x)=>{
    const parts=[cyl(R,R,th,[0,0,0],c,{seg:Math.max(16,n*2)}), cyl(R*0.22,R*0.22,th*1.4,[0,0,0],'#2a2a2a')];
    for(let i=0;i<n;i++){ const a=i/n*2*PI; parts.push(box(2*PI*R/n*0.42, th, R*0.24, [Math.sin(a)*R*1.08, 0, Math.cos(a)*R*1.08], c, {r:[0,a,0]})); }
    return grp((x&&x.p)||[0,0,0], (x&&x.r)||null, parts, x);
  };
  /* block letters (3×5, W/M 5×5) built from boxes, facing +Z; cell = pixel size */
  const FONT = { E:['111','100','110','100','111'], X:['101','101','010','101','101'], I:['111','010','010','010','111'], T:['111','010','010','010','010'],
    '7':['111','001','010','010','010'], R:['110','101','110','101','101'], P:['110','101','110','100','100'], O:['111','101','101','101','111'],
    W:['10001','10001','10101','10101','01010'], A:['010','101','111','101','101'], N:['101','111','111','101','101'], G:['111','100','101','101','111'],
    L:['100','100','100','100','111'], D:['110','101','101','101','110'], U:['101','101','101','101','111'], S:['111','100','111','001','111'],
    M:['10001','11011','10101','10001','10001'], C:['111','100','100','100','111'], Y:['101','101','010','010','010'], '1':['010','110','010','010','111'],
    '-':['000','000','111','000','000'], ' ':['000','000','000','000','000'] };
  const letters = (text, cell, p, c, x)=>{
    const depth=(x&&x.depth)||cell*0.7, parts=[]; const chars=[...String(text)];
    const totalW = chars.reduce((w,ch)=>w+((FONT[ch]||FONT[' '])[0].length+1)*cell, 0)-cell; let cx=-totalW/2;
    for(const ch of chars){ const bm=FONT[ch]||FONT[' ']; const cols=bm[0].length;
      for(let r=0;r<5;r++) for(let col=0;col<cols;col++) if(bm[r][col]==='1') parts.push(box(cell*1.02, cell*1.02, depth, [cx+col*cell+cell/2, (2-r)*cell, 0], c, {e:(x&&x.e)||0}));
      cx += (cols+1)*cell; }
    return grp(p, (x&&x.r)||null, parts);
  };
  /* a four-point sparkle star in the XY plane */
  const star4 = (size, th, p, c, x)=>grp(p, (x&&x.r)||null, [
    prism([[0,-size],[size*0.26,0],[0,size],[-size*0.26,0]], th, [0,0,0], c, {e:(x&&x.e)||0}),
    prism([[0,-size],[size*0.26,0],[0,size],[-size*0.26,0]], th, [0,0,0], c, {e:(x&&x.e)||0, r:[0,0,X]}) ], x);
  const ring = (i,n)=>i/n*PI*2;

  /* =====================================================================
     VEHICLES
     ===================================================================== */

  /* Wario's transport helicopter: fat yellow cabin, purple trim, the W on the
     side door, a searchlight under the chin that is pointing at you, the
     loudhailer, the belly hatch hanging open, the yellow warning light. Nose +X. */
  T.helicopter = (P)=>[
    sph(0.8,[0.1,0.95,0],'body',{sc:[1.3,0.75,0.82],seg:30,rings:18}),
    sph(0.64,[0.8,1.0,0],'glass',{sc:[0.95,0.72,0.86],seg:26,rings:14,a:0.78,metal:0.9}),
    box(1.4,0.1,0.95,[0.05,0.42,0],'trim'),
    box(0.7,0.03,0.42,[0.05,0.26,0.44],'trim',{r:[0.7,0,0]}),          /* belly hatch, open */
    box(0.7,0.03,0.42,[0.05,0.26,-0.44],'trim',{r:[-0.7,0,0]}),
    cyl(0.11,0.21,2.3,[-1.75,1.0,0],'body',{r:[0,0,X]}),                 /* tail boom */
    prism([[-0.1,0],[0.32,0],[0.5,0.85],[0.22,0.85]],0.06,[-2.85,1.05,0],'trim'),
    box(0.45,0.04,1.0,[-2.5,1.1,0],'trim'),
    grp([-2.78,1.6,0.09],null,[cyl(0.05,0.05,0.1,[0,0,-0.02],'rotor',{r:[X,0,0]}), box(0.06,0.8,0.03,[0,0,0.03],'rotor'), box(0.8,0.06,0.03,[0,0,0.03],'rotor')],{spin:{axis:'z',speed:16}}),
    cyl(0.07,0.09,0.4,[0.1,1.6,0],'rotor'),                               /* mast */
    grp([0.1,1.8,0],null,[cyl(0.14,0.14,0.1,[0,0,0],'rotor'), box(4.4,0.035,0.24,[0,0.02,0],'rotor'), box(0.24,0.035,4.4,[0,0.055,0],'rotor')],{spin:{axis:'y',speed:7}}),
    cyl(0.035,0.035,2.1,[0.15,0.12,0.55],'rotor',{r:[0,0,X]}), cyl(0.035,0.035,2.1,[0.15,0.12,-0.55],'rotor',{r:[0,0,X]}),
    sph(0.05,[1.2,0.17,0.55],'rotor'), sph(0.05,[1.2,0.17,-0.55],'rotor'),
    bar3([0.6,0.12,0.55],[0.5,0.5,0.4],0.03,'rotor'), bar3([-0.4,0.12,0.55],[-0.35,0.5,0.4],0.03,'rotor'),
    bar3([0.6,0.12,-0.55],[0.5,0.5,-0.4],0.03,'rotor'), bar3([-0.4,0.12,-0.55],[-0.35,0.5,-0.4],0.03,'rotor'),
    box(0.56,0.52,0.04,[-0.2,0.9,0.73],'trim'),                           /* side door */
    letters('W',0.055,[-0.2,0.9,0.76],'body'),
    box(0.56,0.52,0.04,[-0.2,0.9,-0.73],'trim'),
    letters('W',0.055,[-0.2,0.9,-0.76],'body',{r:[0,PI,0]}),
    cyl(0.15,0.13,0.18,[1.35,0.55,0],'rotor',{r:[0,0,-X]}),               /* searchlight */
    cyl(0.11,0.11,0.02,[1.45,0.55,0],'#fff2b0',{r:[0,0,-X],e:1}),
    bar3([1.46,0.55,0],[3.2,-0.75,0],0.72,'#ffe9a0',{r2:0.1,a:0.07,e:1,caps:false,nb:true,seg:24}),
    bar3([1.46,0.55,0],[3.0,-0.6,0],0.36,'#fff6d0',{r2:0.08,a:0.08,e:1,caps:false,nb:true,seg:20}),
    cyl(0.17,0.06,0.3,[1.2,0.42,-0.3],'rotor',{r:[0,0,-X]}),              /* loudhailer */
    cyl(0.08,0.08,0.06,[-0.5,1.44,0],'rotor'),
    sph(0.07,[-0.5,1.5,0],'#ffb300',{e:1}),                               /* the yellow light */
  ];
  T.helicopter.view = {yaw:0.75, pitch:0.28};
  const ghostify = (parts)=>parts.map(p=>p.parts ? Object.assign({}, p, {parts:ghostify(p.parts)}) : Object.assign({}, p, {ghost:true}));
  T.helicopter_ghost = (P)=>ghostify(T.helicopter(P));
  T.helicopter_ghost.view = T.helicopter.view;

  /* The Regal Empire's military airship: rigid envelope, cruciform fins,
     gondola with lit windows, two engine pods, a belly turret. Nose +X. */
  T.airship = (P)=>[
    grp([0,0,0],[0,0,-X],[ lathe([[0,-2.0],[0.22,-1.8],[0.45,-1.3],[0.62,-0.6],[0.7,0.0],[0.68,0.6],[0.58,1.2],[0.4,1.6],[0.2,1.85],[0,1.95]],[0,0,0],'envelope',{seg:36}) ]),
    tor(0.705,0.015,[0,0,0],'brass',{r:[0,X,0]}), tor(0.62,0.015,[-0.6,0,0],'brass',{r:[0,X,0]}), tor(0.68,0.015,[0.6,0,0],'brass',{r:[0,X,0]}),
    prism([[-1.9,0.2],[-1.1,0.45],[-1.3,0.95],[-1.95,0.75]],0.05,[0,0,0],'fin'),
    prism([[-1.9,0.2],[-1.1,0.45],[-1.3,0.95],[-1.95,0.75]],0.05,[0,0,0],'fin',{r:[PI,0,0]}),
    prism([[-1.9,0.2],[-1.1,0.45],[-1.3,0.95],[-1.95,0.75]],0.05,[0,0,0],'fin',{r:[X,0,0]}),
    prism([[-1.9,0.2],[-1.1,0.45],[-1.3,0.95],[-1.95,0.75]],0.05,[0,0,0],'fin',{r:[-X,0,0]}),
    cone(0.1,0.25,[2.05,0,0],'brass',{r:[0,0,-X]}),
    box(1.1,0.3,0.4,[0.3,-0.78,0],'gondola'), box(1.14,0.03,0.44,[0.3,-0.64,0],'brass'),
    ...[-0.1,0.15,0.4,0.65].map(x=>box(0.14,0.1,0.42,[x,-0.76,0],'#ffe9a0',{e:0.8})),
    bar3([-0.3,-0.35,0.5],[-0.3,-0.45,0.85],0.025,'gondola'), bar3([-0.3,-0.35,-0.5],[-0.3,-0.45,-0.85],0.025,'gondola'),
    cyl(0.1,0.12,0.4,[-0.3,-0.45,0.85],'gondola',{r:[0,0,-X]}), cyl(0.1,0.12,0.4,[-0.3,-0.45,-0.85],'gondola',{r:[0,0,-X]}),
    grp([-0.07,-0.45,0.85],null,[sph(0.05,[0,0,0],'brass'), box(0.02,0.55,0.07,[0,0,0],'brass'), box(0.02,0.07,0.55,[0,0,0],'brass')],{spin:{axis:'x',speed:18}}),
    grp([-0.07,-0.45,-0.85],null,[sph(0.05,[0,0,0],'brass'), box(0.02,0.55,0.07,[0,0,0],'brass'), box(0.02,0.07,0.55,[0,0,0],'brass')],{spin:{axis:'x',speed:-18}}),
    cyl(0.12,0.14,0.1,[-0.9,-0.6,0],'gondola'), bar3([-0.9,-0.62,0],[-0.6,-0.72,0.1],0.025,'brass'),
  ];
  T.airship.view = {yaw:0.9, pitch:0.22};

  /* The Maglev Express: a streamlined lead car and a Research & Logistics car
     riding a glowing guideway, the control-hub dome on the roof. Along X. */
  T.train = (P)=>[
    box(4.8,0.12,0.9,[-0.5,0.06,0],'rail'), box(4.8,0.08,0.3,[-0.5,0.16,0],'#3a3a44'),
    box(3.9,0.03,0.5,[-0.6,0.22,0],'#4fc3f7',{e:1,a:0.6}),
    box(2.0,0.5,0.7,[-0.1,0.55,0],'body'), sph(0.36,[1.0,0.55,0],'body',{sc:[1.6,0.72,1],seg:24,rings:14}),
    sph(0.3,[1.05,0.66,0],'glass',{sc:[1.3,0.5,0.95],a:0.85,metal:0.9}),
    box(2.0,0.08,0.72,[-0.1,0.45,0],'stripe'), box(1.6,0.14,0.72,[-0.3,0.66,0],'glass',{a:0.9,metal:0.8}),
    box(1.9,0.06,0.6,[-0.1,0.82,0],'body'),
    cyl(0.16,0.2,0.1,[0.4,0.88,0],'stripe'), sph(0.14,[0.4,0.95,0],'glass',{a:0.8}),
    box(1.6,0.5,0.7,[-2.0,0.55,0],'body'), box(1.6,0.08,0.72,[-2.0,0.45,0],'stripe'), box(1.3,0.14,0.72,[-2.0,0.66,0],'glass',{a:0.9,metal:0.8}),
    box(1.5,0.06,0.6,[-2.0,0.82,0],'body'), sph(0.3,[-2.8,0.55,0],'body',{sc:[0.6,0.8,1]}),
    cyl(0.12,0.12,0.02,[-2.0,0.6,0.36],'stripe',{r:[X,0,0]}),
    box(3.6,0.12,0.74,[-0.9,0.3,0],'rail'), box(0.3,0.1,0.2,[-1.0,0.5,0],'rail'),
  ];
  T.train.view = {yaw:0.8, pitch:0.3};

  /* Bowser's Koopa Clown Car: the grinning green bowl, yellow rim, propeller. */
  T.clown_car = (P)=>[
    grp([0,0,0],null,[
      lathe([[0,0.0],[0.35,0.0],[0.55,0.12],[0.66,0.4],[0.7,0.8],[0.62,0.8],[0.6,0.5],[0.5,0.25],[0,0.2]],[0,0,0],'body',{seg:36}),
      tor(0.68,0.06,[0,0.82,0],'rim',{r:[X,0,0]}),
      cyl(0.32,0.3,0.1,[0,0.3,0],'#8b1a1a'),
      sph(0.14,[0.2,0.55,0.6],'face',{sc:[1,1.3,0.5]}), sph(0.14,[-0.2,0.55,0.6],'face',{sc:[1,1.3,0.5]}),
      sph(0.055,[0.2,0.55,0.665],'#111111'), sph(0.055,[-0.2,0.55,0.665],'#111111'),
      cyl(0.09,0.09,0.02,[0.45,0.4,0.48],'#ff7aa2',{r:[X,0,-0.7]}), cyl(0.09,0.09,0.02,[-0.45,0.4,0.48],'#ff7aa2',{r:[X,0,0.7]}),
      tube(Array.from({length:9},(_,i)=>{ const x=-0.3+0.6*i/8; return [x, 0.36-0.13*Math.sin(PI*i/8), Math.sqrt(Math.max(0,0.62*0.62-x*x))]; }),0.035,'mouth',{seg:10}),
      cyl(0.06,0.06,0.15,[0,-0.08,0],'#555566'),
      grp([0,-0.17,0],null,[box(0.95,0.03,0.12,[0,0,0],'#555566'), box(0.12,0.03,0.95,[0,0,0],'#555566')],{spin:{axis:'y',speed:12}}),
    ],{bob:{amp:0.04,speed:2}}),
  ];
  T.clown_car.view = {yaw:0.25, pitch:0.3};

  /* =====================================================================
     SIEGE, WEAPONS
     ===================================================================== */

  /* The W-stamped claw: yellow-and-black housing with hazard stripes and the
     W plate, hydraulic arm, three talons, and the smaller pincer beside it. */
  T.claw_arm = (P)=>{
    const talon = (k)=>grp([0,0.45,0],[0,ring(k,3),0],[
      bar2([0,0],[0.5,-0.6],0.14,'body',{depth:0.12}),
      sph(0.1,[0.5,-0.6,0],'stripe'),
      bar2([0.5,-0.6],[0.3,-1.3],0.12,'body',{depth:0.1}),
      bar3([0.3,-1.3,0],[0.2,-1.62,0],0.075,'stripe',{r2:0.0}),
    ]);
    return [
      cyl(0.03,0.03,0.5,[0,2.6,0],'stripe'), tor(0.16,0.03,[0,2.35,0],'steel'),
      box(0.9,0.5,0.8,[0,1.95,0],'body'),
      ...[-0.3,-0.1,0.1,0.3].map(x=>box(0.08,0.54,0.02,[x,1.95,0.41],'stripe',{r:[0,0,0.55]})),
      ...[-0.3,-0.1,0.1,0.3].map(x=>box(0.08,0.54,0.02,[x,1.95,-0.41],'stripe',{r:[0,0,-0.55]})),
      box(0.03,0.36,0.36,[0.46,1.95,0],'stripe'), letters('W',0.05,[0.475,1.95,0],'mark',{r:[0,X,0]}),
      box(0.03,0.36,0.36,[-0.46,1.95,0],'stripe'), letters('W',0.05,[-0.475,1.95,0],'mark',{r:[0,-X,0]}),
      ...[[-0.4,0.35],[0.4,0.35],[-0.4,-0.35],[0.4,-0.35]].map(([x,z])=>sph(0.04,[x,2.22,z],'steel')),
      cyl(0.17,0.17,0.9,[0,1.25,0],'steel'), cyl(0.1,0.1,0.7,[0,0.75,0],'#c9c9d4',{metal:0.9}),
      tube([[0.3,1.7,0.2],[0.42,1.3,0.28],[0.3,0.9,0.22],[0.14,0.6,0.1]],0.025,'stripe'),
      tube([[-0.3,1.7,-0.2],[-0.42,1.3,-0.28],[-0.3,0.9,-0.22],[-0.14,0.6,-0.1]],0.025,'stripe'),
      sph(0.26,[0,0.45,0],'body'), tor(0.27,0.04,[0,0.5,0],'stripe',{r:[X,0,0]}),
      talon(0), talon(1), talon(2),
      bar3([0.35,1.7,0],[0.8,1.2,0],0.05,'steel'), sph(0.08,[0.8,1.2,0],'stripe'),
      grp([0.8,1.2,0],null,[ bar2([0,0],[0.14,-0.34],0.05,'steel'), bar2([0,0],[-0.14,-0.34],0.05,'steel'),
        bar3([0.14,-0.34,0],[0.08,-0.5,0],0.03,'stripe',{r2:0}), bar3([-0.14,-0.34,0],[-0.08,-0.5,0],0.03,'stripe',{r2:0}) ]),
    ];
  };
  T.claw_arm.view = {yaw:0.5, pitch:0.2};

  /* A courier's cheap pistol: slide, frame, protruding barrel, wooden grip,
     trigger guard, hammer back. Muzzle +X. */
  T.pistol = (P)=>[
    prism([[-0.55,0.52],[0.6,0.52],[0.6,0.62],[0.52,0.74],[-0.55,0.74]],0.17,[0,0,0],'metal',{metal:0.7}),
    box(0.95,0.14,0.16,[0.0,0.45,0],'metal',{metal:0.7}),
    cyl(0.045,0.045,0.3,[0.72,0.63,0],'metal',{r:[0,0,-X],metal:0.8}), cyl(0.03,0.03,0.012,[0.875,0.63,0],'#111111',{r:[0,0,-X]}),
    prism([[-0.62,-0.2],[-0.33,-0.2],[-0.2,0.38],[-0.5,0.38]],0.17,[0,0,0],'grip'),
    box(0.26,0.05,0.18,[-0.47,-0.22,0],'metal'),
    tor(0.11,0.018,[0.03,0.3,0],'metal',{rings:8}), bar2([0.02,0.4],[0.06,0.26],0.03,'metal',{depth:0.04}),
    bar2([-0.55,0.7],[-0.66,0.85],0.05,'metal',{depth:0.06}),
    box(0.06,0.05,0.12,[-0.45,0.77,0],'metal'), box(0.04,0.05,0.04,[0.5,0.77,0],'metal'),
    box(0.18,0.08,0.01,[0.05,0.66,0.09],'#2a2a30'),
    ...[-0.46,-0.42,-0.38,-0.34].map(x=>box(0.012,0.14,0.012,[x,0.63,0.088],'#2a2a30')),
    sph(0.025,[-0.42,0.1,0.09],'accent',{metal:0.9}), sph(0.025,[-0.42,0.1,-0.09],'accent',{metal:0.9}),
  ];
  T.pistol.view = {yaw:0.35, pitch:0.22};

  /* Green T's birthday musket, bow still on it: long barrel, flintlock, ramrod. Muzzle +X. */
  T.musket = (P)=>{ const rib = P.ribbon || '#ff4fa3'; return [
    prism([[-1.5,-0.28],[-0.7,-0.02],[-0.7,0.12],[-1.1,0.2],[-1.5,0.25]],0.1,[0,0,0],'wood'),
    box(1.4,0.1,0.09,[0.0,0.03,0],'wood'),
    cyl(0.045,0.05,2.6,[0.4,0.14,0],'metal',{r:[0,0,-X],metal:0.7}), cyl(0.03,0.03,0.01,[1.705,0.14,0],'#111111',{r:[0,0,-X]}),
    cyl(0.015,0.015,2.0,[0.5,-0.04,0],'metal',{r:[0,0,X]}),
    tor(0.06,0.012,[0.2,0.14,0],'brass',{r:[0,X,0]}), tor(0.06,0.012,[0.65,0.14,0],'brass',{r:[0,X,0]}),
    box(0.3,0.1,0.02,[-0.55,0.08,0.055],'brass'),
    bar2([-0.62,0.1],[-0.7,0.3],0.04,'metal',{depth:0.03,z:0.07}), bar2([-0.42,0.12],[-0.4,0.28],0.03,'metal',{depth:0.03,z:0.07}),
    tor(0.08,0.012,[-0.6,-0.06,0],'brass',{rings:8}), bar2([-0.6,0.0],[-0.58,-0.08],0.02,'metal'),
    box(0.04,0.55,0.1,[-1.52,0.0,0],'brass'), box(0.02,0.04,0.02,[1.6,0.2,0],'brass'),
    tor(0.08,0.02,[0.02,0.27,0],rib,{r:[0,0,0.5],rings:8}), tor(0.08,0.02,[0.18,0.27,0],rib,{r:[0,0,-0.5],rings:8}),
    sph(0.04,[0.1,0.21,0],rib), bar2([0.1,0.2],[0.0,0.0],0.03,rib,{depth:0.01,z:0.06}), bar2([0.1,0.2],[0.22,0.02],0.03,rib,{depth:0.01,z:0.06}),
  ]; };
  T.musket.view = {yaw:0.3, pitch:0.25};

  /* The Wario-brand garlic grenade: a garlic bulb with cloves, the yellow
     band with the W, spoon lever and pin ring. */
  T.grenade = (P)=>[
    lathe([[0,0],[0.25,0.03],[0.45,0.2],[0.5,0.45],[0.42,0.7],[0.25,0.85],[0.12,0.95],[0.06,1.1],[0.03,1.25],[0,1.25]],[0,0,0],'body',{seg:30}),
    ...[0,1,2,3,4,5].map(i=>sph(0.2,[Math.sin(ring(i,6))*0.3,0.45,Math.cos(ring(i,6))*0.3],'body',{sc:[1,1.6,1]})),
    tor(0.5,0.045,[0,0.4,0],'band',{r:[X,0,0]}), letters('W',0.03,[0,0.4,0.53],'#7a3fcf'),
    cyl(0.1,0.1,0.12,[0,1.3,0],'pin'), cyl(0.012,0.012,0.2,[0.05,1.36,0],'pin',{r:[0,0,X]}),
    tor(0.1,0.015,[0.2,1.4,0],'pin',{rings:8}),
    bar2([0.05,1.36],[0.32,0.95],0.05,'pin',{depth:0.08}),
  ];

  /* Bowser's portable Bullet Bill cannon: black blaster, yellow muzzle ring,
     a Bullet Bill in the mouth, carried on a spiked green shell. Muzzle +X. */
  T.cannon = (P)=>[
    cyl(0.3,0.3,1.4,[0,0.75,0],'barrel',{r:[0,0,-X]}), cyl(0.4,0.36,0.14,[0.75,0.75,0],'barrel',{r:[0,0,-X]}),
    tor(0.4,0.025,[0.83,0.75,0],'accent',{r:[0,X,0]}), sph(0.3,[-0.7,0.75,0],'barrel',{sc:[0.5,1,1]}),
    tor(0.31,0.03,[-0.3,0.75,0],'band',{r:[0,X,0]}), tor(0.31,0.03,[0.3,0.75,0],'band',{r:[0,X,0]}),
    grp([0.45,0.75,0],[0,0,-X],[
      lathe([[0.26,0],[0.27,0.4],[0.24,0.6],[0.17,0.78],[0.08,0.9],[0,0.95]],[0,0,0],'#111111',{seg:28}),
      sph(0.06,[0.14,0.6,0.2],'#ffffff',{e:0.6}), sph(0.06,[-0.14,0.6,0.2],'#ffffff',{e:0.6}),
      sph(0.03,[0.15,0.6,0.25],'#111111'), sph(0.03,[-0.15,0.6,0.25],'#111111'),
      box(0.12,0.03,0.02,[0.15,0.69,0.23],'#ffffff',{r:[0,0,-0.5]}), box(0.12,0.03,0.02,[-0.15,0.69,0.23],'#ffffff',{r:[0,0,0.5]}),
      cyl(0.05,0.05,0.2,[0.3,0.2,0],'#ffffff',{r:[0,0,-0.9]}), cyl(0.05,0.05,0.2,[-0.3,0.2,0],'#ffffff',{r:[0,0,0.9]}),
    ]),
    box(0.5,0.04,0.06,[-0.1,1.12,0],'band'), box(0.04,0.1,0.06,[-0.32,1.07,0],'band'), box(0.04,0.1,0.06,[0.12,1.07,0],'band'),
    sph(0.5,[-1.0,0.65,0],'shell',{sc:[0.5,1,1]}), tor(0.46,0.045,[-0.78,0.65,0],'accent',{r:[0,X,0]}),
    cone(0.07,0.2,[-1.2,0.95,0],'#f3e9d2',{r:[0,0,0.5]}), cone(0.07,0.2,[-1.22,0.65,0.3],'#f3e9d2',{r:[0.8,0,0.3]}), cone(0.07,0.2,[-1.22,0.65,-0.3],'#f3e9d2',{r:[-0.8,0,0.3]}),
    tube([[-0.5,1.0,0.2],[-0.95,0.55,0.35],[-0.6,0.25,0.3]],0.025,'#2a2a2a'),
    bar3([0.4,0.5,0.1],[0.6,0.0,0.35],0.025,'band'), bar3([0.4,0.5,-0.1],[0.6,0.0,-0.35],0.025,'band'),
  ];
  T.cannon.view = {yaw:0.55, pitch:0.22};

  /* =====================================================================
     COMMUNICATIONS, DEVICES
     ===================================================================== */

  /* A field radio: the set, the dials and frequency window, whip antenna,
     the handset hung on its side with a coiled cord. */
  T.radio = (P)=>[
    box(1.0,0.62,0.36,[0,0.45,0],'body'), box(1.04,0.04,0.4,[0,0.78,0],'grille'), box(1.04,0.04,0.4,[0,0.13,0],'grille'),
    box(0.48,0.44,0.012,[-0.22,0.45,0.185],'#6b5f86'),
    ...[0,1,2,3,4,5].map(i=>box(0.42,0.03,0.02,[-0.22,0.29+i*0.065,0.19],'grille')),
    cyl(0.09,0.09,0.05,[0.28,0.6,0.2],'dial',{r:[X,0,0]}), box(0.02,0.07,0.012,[0.28,0.63,0.23],'#1a1a1a'),
    cyl(0.055,0.055,0.05,[0.28,0.28,0.2],'dial',{r:[X,0,0]}), box(0.015,0.045,0.012,[0.28,0.3,0.23],'#1a1a1a'),
    box(0.26,0.1,0.02,[0.28,0.45,0.19],'#1a1a1a'), box(0.2,0.05,0.012,[0.28,0.45,0.205],'#9fd3ff',{e:0.8}), box(0.012,0.07,0.014,[0.33,0.45,0.21],'#ff6b35',{e:1}),
    box(0.5,0.05,0.12,[0,0.9,0],'grille'), box(0.05,0.14,0.12,[-0.22,0.83,0],'grille'), box(0.05,0.14,0.12,[0.22,0.83,0],'grille'),
    cyl(0.05,0.05,0.08,[-0.4,0.82,-0.08],'grille'), cyl(0.012,0.02,1.2,[-0.4,1.45,-0.08],'antenna'), sph(0.03,[-0.4,2.05,-0.08],'antenna'),
    sph(0.09,[0.62,0.75,0.1],'grille',{sc:[1,0.6,1]}), sph(0.09,[0.62,0.17,0.1],'grille',{sc:[1,0.6,1]}), cyl(0.035,0.035,0.55,[0.62,0.46,0.1],'grille'),
    box(0.03,0.08,0.03,[0.59,0.5,0.1],'dial'),
    grp([0.64,0.2,-0.12],null,[ tube(helix([0,0,0],0.05,0.5,7,42),0.012,'grille',{joints:false,seg:8}) ],{r:[0,0,0.4]}),
    ...[[-0.42,0.14],[0.42,0.14],[-0.42,-0.14],[0.42,-0.14]].map(([x,z])=>box(0.08,0.04,0.08,[x,0.1,z],'grille')),
  ];
  T.radio.view = {yaw:0.5, pitch:0.28};

  /* The WarioWare Tower brass telephone: rotary dial, cradle, handset, coiled cord, bells. */
  T.telephone = (P)=>[
    box(1.1,0.5,0.9,[0,0.25,0],'body'), box(1.12,0.04,0.92,[0,0.05,0],'brass'), box(1.0,0.1,0.8,[0,0.55,0],'body'),
    cyl(0.2,0.2,0.04,[0,0.26,0.47],'brass',{r:[X,0,0]}), cyl(0.09,0.09,0.03,[0,0.26,0.5],'body',{r:[X,0,0]}),
    ...[0,1,2,3,4,5,6,7,8,9].map(i=>cyl(0.028,0.028,0.02,[Math.sin(ring(i,10)+0.4)*0.145,0.26+Math.cos(ring(i,10)+0.4)*0.145,0.5],'#1a1a1a',{r:[X,0,0],seg:10})),
    box(0.03,0.08,0.03,[0.05,0.06,0.5],'brass'),
    cyl(0.04,0.04,0.25,[-0.32,0.72,0],'brass'), cyl(0.04,0.04,0.25,[0.32,0.72,0],'brass'),
    tor(0.09,0.02,[-0.32,0.85,0],'brass',{r:[X,0,0]}), tor(0.09,0.02,[0.32,0.85,0],'brass',{r:[X,0,0]}),
    cyl(0.045,0.045,0.72,[0,0.98,0],'body',{r:[0,0,X]}),
    cyl(0.06,0.11,0.12,[-0.42,0.9,0],'body'), cyl(0.06,0.11,0.12,[0.42,0.9,0],'body'),
    tor(0.1,0.015,[-0.42,0.85,0],'brass',{r:[X,0,0]}), tor(0.1,0.015,[0.42,0.85,0],'brass',{r:[X,0,0]}),
    grp([-0.65,0.45,0.25],null,[ tube(helix([0,0,0],0.05,0.6,7,42),0.014,'cord',{joints:false,seg:8}) ]),
    bar3([-0.65,0.75,0.25],[-0.5,0.86,0.05],0.014,'cord'), bar3([-0.65,0.15,0.25],[-0.55,0.1,0.3],0.014,'cord'),
    sph(0.1,[-0.25,0.56,-0.3],'brass',{sc:[1,0.7,1]}), sph(0.1,[0.25,0.56,-0.3],'brass',{sc:[1,0.7,1]}),
    letters('W',0.025,[0,0.48,0.46],'brass'),
  ];
  T.telephone.view = {yaw:0.45, pitch:0.3};

  /* The Fawthful drone: a green pod with one red lens, four guarded rotors, hovering. */
  T.drone = (P)=>[
    grp([0,0,0],null,[
      sph(0.3,[0,0.5,0],'body',{sc:[1,0.8,1]}), sph(0.2,[0,0.38,0],'metal',{sc:[1,0.5,1]}),
      tor(0.31,0.03,[0,0.52,0],'metal',{r:[X,0,0]}),
      sph(0.11,[0,0.52,0.27],'eye',{e:1}), tor(0.12,0.025,[0,0.52,0.28],'metal'),
      ...[[1,1],[1,-1],[-1,1],[-1,-1]].map(([sx,sz],i)=>grp([0,0,0],null,[
        bar3([0,0.5,0],[sx*0.55,0.55,sz*0.55],0.03,'metal'),
        cyl(0.035,0.035,0.08,[sx*0.55,0.55,sz*0.55],'metal'),
        tor(0.3,0.015,[sx*0.55,0.58,sz*0.55],'metal',{r:[X,0,0]}),
        grp([sx*0.55,0.6,sz*0.55],null,[box(0.52,0.012,0.06,[0,0,0],'#2a2a2a'), box(0.06,0.012,0.52,[0,0,0],'#2a2a2a')],{spin:{axis:'y',speed:(i%2?22:-22)}}),
      ])),
      cyl(0.01,0.01,0.25,[0,0.85,0],'metal'), sph(0.025,[0,0.98,0],'eye',{e:1}),
      bar3([0.12,0.28,0],[0.16,0.1,0],0.015,'metal'), bar3([-0.12,0.28,0],[-0.16,0.1,0],0.015,'metal'),
    ],{bob:{amp:0.04,speed:3}}),
  ];
  T.drone.view = {yaw:0.4, pitch:0.3};

  /* The sanctum telescope on its platform, clockwork turning under it. */
  T.telescope = (P)=>[
    cyl(0.9,1.0,0.12,[0,0.06,0],'#3a3344'), tor(0.95,0.03,[0,0.12,0],'brass',{r:[X,0,0]}),
    gear(0.35,14,0.06,'brass',{p:[0.55,0.16,0.45],spin:{axis:'y',speed:0.6}}),
    gear(0.22,10,0.06,'brass',{p:[0.12,0.16,0.8],spin:{axis:'y',speed:-0.95}}),
    gear(0.18,8,0.06,'brass',{p:[-0.6,0.16,0.45],spin:{axis:'y',speed:1.2}}),
    cyl(0.1,0.14,0.9,[0,0.57,0],'brass'), sph(0.14,[0,1.02,0],'brass'),
    box(0.06,0.4,0.08,[-0.2,1.2,0],'brass'), box(0.06,0.4,0.08,[0.2,1.2,0],'brass'), cyl(0.04,0.04,0.46,[0,1.35,0],'brass',{r:[0,0,X]}),
    grp([0,1.35,0],[0,0,-0.55],[
      cyl(0.13,0.15,1.8,[0,0.5,0],'tube'), cyl(0.17,0.17,0.35,[0,1.5,0],'brass'), cyl(0.14,0.14,0.02,[0,1.68,0],'lens',{e:0.6}),
      tor(0.15,0.02,[0,0.1,0],'brass',{r:[X,0,0]}), tor(0.15,0.02,[0,1.0,0],'brass',{r:[X,0,0]}),
      cyl(0.06,0.06,0.3,[0,-0.5,0],'brass'), cyl(0.08,0.06,0.06,[0,-0.66,0],'#1a1a1a'),
      cyl(0.05,0.05,0.2,[0,-0.3,0],'brass',{r:[X,0,0]}),
      cyl(0.04,0.04,0.5,[0,0.9,0.2],'brass'), bar3([0,0.7,0.14],[0,0.7,0.2],0.015,'brass'), bar3([0,1.1,0.14],[0,1.1,0.2],0.015,'brass'),
    ]),
    bar3([0,1.35,0],[-0.5,1.1,0],0.03,'brass'), sph(0.12,[-0.55,1.08,0],'brass'),
  ];
  T.telescope.view = {yaw:0.6, pitch:0.25};

  /* The kitchen device that could close every portal: a stove with a hoop on
     top, a core in the hoop, runes orbiting it — and the kettle, because it is
     a kitchen. */
  T.portal_device = (P)=>[
    box(1.2,0.9,0.7,[0,0.45,0],'frame'), box(1.24,0.05,0.74,[0,0.92,0],'brass'),
    box(0.7,0.5,0.03,[0,0.4,0.36],'#1a1430'), box(0.5,0.3,0.02,[0,0.42,0.38],'#9fd3ff',{a:0.6}), box(0.6,0.04,0.04,[0,0.62,0.4],'brass'),
    ...[-0.4,0,0.4].map(x=>cyl(0.06,0.06,0.05,[x,0.8,0.37],'brass',{r:[X,0,0]})),
    ...[-0.4,0,0.4].map(x=>box(0.012,0.05,0.012,[x,0.83,0.4],'#1a1a1a')),
    ...[0,1,2,3,4].map(i=>box(0.02,0.25,0.4,[0.61,0.3+i*0.1,0],'#1a1430')),
    box(0.2,0.12,0.2,[0,1.0,0],'brass'), tor(0.55,0.045,[0,1.6,0],'ring'),
    tor(0.4,0.02,[0,1.6,0],'brass',{r:[0.3,0,0],spin:{axis:'y',speed:1.4}}),
    sph(0.17,[0,1.6,0],'core',{e:1}), sph(0.26,[0,1.6,0],'core',{a:0.25,e:1}),
    grp([0,1.6,0],null,[box(0.06,0.06,0.06,[0.47,0,0],'core',{e:1,r:[0.5,0.5,0]}), box(0.06,0.06,0.06,[-0.47,0.1,0],'core',{e:1,r:[0.2,0.7,0]}), box(0.06,0.06,0.06,[0,-0.1,0.47],'core',{e:1,r:[0.4,0,0.5]})],{spin:{axis:'y',speed:0.9}}),
    tube([[-0.6,0.3,-0.3],[-0.9,0.1,-0.4],[-1.1,0.02,-0.1]],0.02,'#1a1a1a'), box(0.1,0.06,0.08,[-1.14,0.03,-0.08],'#1a1a1a'),
    lathe([[0,0],[0.14,0],[0.17,0.12],[0.13,0.22],[0.05,0.3],[0,0.3]],[-0.42,0.95,0.05],'brass',{seg:20}),
    bar3([-0.3,1.07,0.05],[-0.2,1.2,0.05],0.02,'brass'), tor(0.07,0.012,[-0.42,1.3,0.05],'brass',{rings:8}),
  ];
  T.portal_device.view = {yaw:0.5, pitch:0.25};

  /* Agent L's vacuum device: red backpack tank, gauge, hose and yellow nozzle. */
  T.vacuum = (P)=>[
    lathe([[0,0],[0.3,0],[0.38,0.1],[0.4,0.5],[0.4,0.9],[0.36,1.0],[0.25,1.08],[0,1.1]],[0,0,0],'body',{seg:30}),
    tor(0.41,0.025,[0,0.3,0],'tank',{r:[X,0,0]}), tor(0.41,0.025,[0,0.75,0],'tank',{r:[X,0,0]}),
    sph(0.3,[0,1.08,0],'tank',{sc:[1,0.5,1]}), tor(0.12,0.025,[0,1.3,0],'tank',{rings:8}),
    cyl(0.1,0.1,0.04,[0,0.75,0.4],'#f3e9d2',{r:[X,0,0]}), tor(0.1,0.015,[0,0.75,0.42],'tank',{rings:8}), box(0.012,0.08,0.01,[0.02,0.78,0.43],'#c0392b',{r:[0,0,-0.6]}),
    box(0.25,0.15,0.03,[0,0.4,0.4],'tank'), ...[0,1,2].map(i=>box(0.2,0.015,0.012,[0,0.36+i*0.04,0.42],'#1a1a1a')),
    box(0.08,0.9,0.03,[0.18,0.6,-0.4],'hose'), box(0.08,0.9,0.03,[-0.18,0.6,-0.4],'hose'),
    cyl(0.32,0.34,0.05,[0,0.02,0],'tank'),
    letters('L',0.03,[0,0.55,0.41],'#2fbf4f',{e:0.3}),
    tube([[0.3,1.0,0.15],[0.75,1.1,0.3],[1.05,0.8,0.35],[1.1,0.4,0.3],[1.0,0.15,0.2]],0.06,'hose'),
    bar3([1.0,0.15,0.2],[0.78,0.03,0.08],0.11,'nozzle',{r2:0.07}),
  ];
  T.vacuum.view = {yaw:0.55, pitch:0.28};

  /* The Legion field syringe: glass barrel, blue fluid, plunger, needle. */
  T.syringe = (P)=>[
    grp([0,0,0],[0,0,-0.6],[
      cyl(0.12,0.12,1.0,[0,0.5,0],'barrel',{a:0.5,metal:0.8}), cyl(0.1,0.1,0.55,[0,0.3,0],'fluid',{e:0.25}),
      ...[0,1,2,3,4].map(i=>tor(0.125,0.006,[0,0.15+i*0.15,0],'#2a2a2a',{r:[X,0,0],rings:6})),
      box(0.5,0.04,0.2,[0,1.0,0],'barrel',{a:0.7}), cyl(0.04,0.04,0.6,[0,1.25,0],'plunger'), cyl(0.14,0.14,0.04,[0,1.55,0],'plunger'),
      cyl(0.1,0.1,0.06,[0,0.58,0],'#2a2a2a'), cyl(0.05,0.08,0.1,[0,-0.04,0],'metal'), cyl(0.012,0.012,0.6,[0,-0.4,0],'metal',{metal:0.9}), cone(0.012,0.05,[0,-0.72,0],'metal',{r:[PI,0,0]}),
    ]),
  ];
  T.syringe.view = {yaw:0.2, pitch:0.2};

  /* The Director's wired remote: a handset of buttons with wires running out of it. */
  T.remote = (P)=>[
    grp([0,0,0],[0.55,0,0],[
      box(0.5,0.1,0.9,[0,0,0],'body'), box(0.44,0.02,0.84,[0,0.055,0],'#3a3a48'), box(0.52,0.03,0.92,[0,-0.02,0],'#5a5a6a'),
      cyl(0.09,0.09,0.05,[0,0.085,0.22],'button',{e:0.4}), tor(0.1,0.012,[0,0.07,0.22],'#8d8d99',{r:[X,0,0],rings:6}),
      ...[0,1,2].flatMap(i=>[0,1,2].map(j=>cyl(0.035,0.035,0.03,[-0.12+i*0.12,0.075,-0.05-j*0.1],((i+j)%3===0)?'button':'button2',{seg:12}))),
      box(0.3,0.015,0.12,[0,0.07,-0.36],'#4fc3f7',{e:0.6}), box(0.04,0.06,0.03,[0.17,0.09,0.4],'#8d8d99'),
      cyl(0.01,0.01,0.35,[0.18,0.25,0.4],'#8d8d99'), sph(0.02,[0.18,0.43,0.4],'button',{e:1}),
      tube([[-0.1,0,-0.46],[-0.2,-0.1,-0.7],[-0.35,-0.15,-0.95]],0.012,'wire'),
      tube([[0.05,0,-0.46],[0.1,-0.12,-0.75],[0.3,-0.2,-0.95]],0.012,'#1a1a1a'),
      tube([[0.15,0,-0.46],[0.25,-0.05,-0.7],[0.15,-0.2,-1.0]],0.012,'wire'),
      box(0.05,0.04,0.08,[-0.36,-0.15,-0.98],'#8d8d99'), box(0.05,0.04,0.08,[0.31,-0.2,-0.98],'#8d8d99'), box(0.05,0.04,0.08,[0.15,-0.2,-1.03],'#8d8d99'),
    ]),
  ];
  T.remote.view = {yaw:0.35, pitch:0.45};
  T.emergency_button = (P)=>[
    box(0.92,1.3,0.18,[0,0.65,0],'body'),
    box(0.76,0.16,0.07,[0,1.12,0.13],'trim'),
    box(0.56,0.62,0.08,[0,0.53,0.14],'trim'),
    tor(0.245,0.035,[0,0.55,0.22],'trim',{r:[X,0,0]}),
    sph(0.18,[0,0.55,0.25],'button',{e:0.12}),
    box(0.42,0.07,0.035,[0,0.13,0.13],'label'),
    box(0.92,0.1,0.18,[0,0.02,0],'body'),
  ];
  T.emergency_button.view = {yaw:0.32, pitch:0.2};

  /* The EMERGENCY EXIT coffee machine: pot on the plate, the red button with
     its label, steam going up into the vent it popped. */
  T.coffee_machine = (P)=>[
    box(0.7,0.08,0.6,[0,0.04,0],'body'), cyl(0.22,0.22,0.02,[0,0.09,0.1],'panel'),
    box(0.7,0.95,0.25,[0,0.55,-0.17],'body'), box(0.2,0.6,0.02,[0.2,0.5,-0.04],'pot',{a:0.7}), box(0.18,0.3,0.015,[0.2,0.35,-0.035],'#4fc3f7',{a:0.6}),
    box(0.7,0.22,0.6,[0,0.95,0],'body'), cyl(0.2,0.2,0.1,[0,0.82,0.1],'panel'),
    lathe([[0,0],[0.19,0],[0.2,0.2],[0.17,0.35],[0.14,0.4],[0,0.4]],[0,0.1,0.1],'pot',{a:0.5,seg:24}),
    cyl(0.16,0.17,0.15,[0,0.18,0.1],'#3b1f0e'), tor(0.09,0.02,[0.24,0.3,0.1],'panel',{rings:8}), cyl(0.16,0.14,0.04,[0,0.52,0.1],'panel'),
    cyl(0.07,0.07,0.04,[-0.22,0.95,0.31],'button',{r:[X,0,0],e:0.5}),
    box(0.3,0.1,0.01,[0.1,0.95,0.305],'button'), letters('EXIT',0.016,[0.1,0.95,0.315],'#ffffff'),
    sph(0.05,[0.05,1.15,0.0],'#ffffff',{a:0.35,bob:{amp:0.02,speed:2}}), sph(0.07,[0.0,1.3,0.02],'#ffffff',{a:0.3,bob:{amp:0.03,speed:1.6}}), sph(0.09,[-0.04,1.47,0.0],'#ffffff',{a:0.22,bob:{amp:0.03,speed:1.3}}),
    box(0.5,0.03,0.4,[0,1.7,0.1],'#555566',{r:[0.6,0,0]}), ...[0,1,2,3].map(i=>box(0.46,0.01,0.03,[0,1.72,-0.08+i*0.1],'#2a2a36',{r:[0.6,0,0]})),
    bar3([-0.25,1.84,-0.08],[-0.25,1.95,-0.08],0.012,'#555566'), bar3([0.25,1.84,-0.08],[0.25,1.95,-0.08],0.012,'#555566'),
  ];
  T.coffee_machine.view = {yaw:0.45, pitch:0.25};

  /* The Mount Ebott survey machine: tripod, head with the screen, rotating
     sensor, the data chip half out of its slot, and the flower that fixed it. */
  T.survey_machine = (P)=>[
    box(0.6,0.45,0.45,[0,1.3,0],'body'), box(0.4,0.22,0.02,[0,1.33,0.235],'screen',{e:0.85}),
    ...[0,1,2].map(i=>box(0.3-i*0.08,0.02,0.012,[-0.05-i*0.04,1.39-i*0.06,0.25],'#0b3a4a')),
    cyl(0.07,0.07,0.25,[0.35,1.3,0],'leg',{r:[0,0,X]}), cyl(0.05,0.05,0.01,[0.48,1.3,0],'#9fd3ff',{r:[0,0,X],e:0.5}),
    cyl(0.012,0.012,0.12,[-0.2,1.58,0.1],'leg'), sph(0.05,[-0.2,1.65,0.1],'light',{e:1}),
    grp([0.05,1.56,-0.05],null,[cyl(0.04,0.04,0.1,[0,0,0],'leg'), box(0.5,0.03,0.08,[0,0.08,0],'body'), box(0.06,0.12,0.03,[0.24,0.14,0],'body')],{spin:{axis:'y',speed:1.5}}),
    box(0.1,0.03,0.02,[0.22,1.53,0.12],'#1a1a1a'), box(0.08,0.01,0.12,[0.22,1.54,0.08],'#1a1a1a',{r:[-0.4,0,0]}), box(0.06,0.012,0.03,[0.22,1.56,0.03],'#e0b400',{r:[-0.4,0,0]}),
    cyl(0.12,0.14,0.15,[0,1.0,0],'leg'),
    ...[0,1,2].map(i=>bar3([0,0.95,0],[Math.sin(ring(i,3))*0.75,0,Math.cos(ring(i,3))*0.75],0.03,'leg')),
    ...[0,1,2].map(i=>sph(0.04,[Math.sin(ring(i,3))*0.75,0.02,Math.cos(ring(i,3))*0.75],'leg')),
    ...[0,1,2].map(i=>bar3([Math.sin(ring(i,3))*0.37,0.48,Math.cos(ring(i,3))*0.37],[Math.sin(ring(i+1,3))*0.37,0.48,Math.cos(ring(i+1,3))*0.37],0.012,'leg')),
    cyl(0.01,0.012,0.3,[0.55,0.15,0.4],'#2f9e44'), sph(0.05,[0.52,0.12,0.44],'#2f9e44',{sc:[1.6,0.3,1]}),
    ...[0,1,2,3,4,5].map(i=>sph(0.045,[0.55+0.055*Math.sin(ring(i,6)),0.32+0.055*Math.cos(ring(i,6)),0.4],'#f4d03f',{sc:[1,1,0.4]})),
    sph(0.03,[0.55,0.32,0.42],'#ffffff'),
  ];
  T.survey_machine.view = {yaw:0.45, pitch:0.22};

  /* =====================================================================
     CONSTRUCTS, INFRASTRUCTURE, MAGITEK
     ===================================================================== */

  /* Cleaning Golem Patrol Unit 7: heavy torso with the 7 on its chest, two
     optical sensors, a spinning brush hand, hydraulics on the legs, a tank. */
  T.golem = (P)=>[
    box(1.0,0.9,0.6,[0,1.45,0],'body'), box(0.7,0.5,0.05,[0,1.5,0.32],'joint'), letters('7',0.05,[0,1.5,0.36],'eye',{e:0.6}),
    sph(0.22,[0.6,1.8,0],'joint'), sph(0.22,[-0.6,1.8,0],'joint'),
    cyl(0.12,0.12,0.12,[0,1.96,0],'joint'), box(0.5,0.4,0.45,[0,2.2,0],'body'),
    sph(0.07,[0.12,2.23,0.24],'eye',{e:1}), sph(0.07,[-0.12,2.23,0.24],'eye',{e:1}),
    cyl(0.03,0.03,0.08,[0,2.44,0],'joint'), sph(0.06,[0,2.5,0],'#ffb300',{e:1}),
    cyl(0.11,0.11,0.6,[0.6,1.45,0],'body'), cyl(0.11,0.11,0.6,[-0.6,1.45,0],'body'),
    sph(0.14,[0.6,1.12,0],'joint'), sph(0.14,[-0.6,1.12,0],'joint'),
    cyl(0.1,0.12,0.55,[0.6,0.85,0],'body'), cyl(0.1,0.12,0.55,[-0.6,0.85,0],'body'),
    grp([0.6,0.52,0],null,[cyl(0.14,0.14,0.08,[0,0,0],'joint'), cyl(0.18,0.2,0.22,[0,-0.14,0],'brush',{seg:14}),
      ...[0,1,2,3,4,5,6,7].map(i=>box(0.02,0.24,0.06,[Math.sin(ring(i,8))*0.17,-0.14,Math.cos(ring(i,8))*0.17],'joint',{r:[0,ring(i,8),0]}))],{spin:{axis:'y',speed:5}}),
    box(0.4,0.06,0.1,[-0.6,0.5,0],'joint'), box(0.06,0.14,0.06,[-0.6,0.5,0],'joint'),
    cyl(0.14,0.16,0.7,[0.3,0.65,0],'body'), cyl(0.14,0.16,0.7,[-0.3,0.65,0],'body'),
    bar3([0.3,1.0,0.22],[0.3,0.5,0.28],0.04,'#c9c9d4',{metal:0.9}), bar3([-0.3,1.0,0.22],[-0.3,0.5,0.28],0.04,'#c9c9d4',{metal:0.9}),
    box(0.4,0.15,0.5,[0.3,0.08,0.05],'joint'), box(0.4,0.15,0.5,[-0.3,0.08,0.05],'joint'),
    cyl(0.2,0.2,0.6,[0,1.45,-0.45],'joint'), tube([[0.15,1.2,-0.5],[0.75,1.0,-0.3],[0.7,0.6,0.1]],0.03,'#1a1a1a'),
  ];
  T.golem.view = {yaw:0.5, pitch:0.22};

  /* The Donut Plains warp pipe: half-buried, vines on it, the yellow-and-blue
     spiral tile at its foot glowing faintly. */
  T.warp_pipe = (P)=>{
    const spiral=[]; const n=44; for(let i=0;i<=n;i++){ const t=i/n, a=t*2.6*PI*2, r=0.04+0.34*t; spiral.push([0.95+r*Math.sin(a),0.075,0.85+r*Math.cos(a)]); }
    const seg=[]; for(let i=0;i<n;i++) seg.push(bar3(spiral[i],spiral[i+1],0.02,(i%2)?'tile':'tile2',{e:0.45,seg:8}));
    return [
      sph(1.1,[0,-0.55,0],'#4a3521',{sc:[1.3,0.5,1.1],seg:28,rings:14}),
      sph(0.14,[-0.9,0.0,0.6],'#6b6560',{sc:[1,0.6,0.8]}), sph(0.1,[0.7,0.0,-0.7],'#6b6560',{sc:[1.2,0.6,1]}),
      grp([0,0,0],[0.1,0,-0.12],[
        cyl(0.42,0.42,1.0,[0,0.2,0],'pipe'), cyl(0.5,0.5,0.3,[0,0.85,0],'rim'), cyl(0.4,0.4,0.28,[0,0.87,0],'#0e2b14'), cyl(0.4,0.4,0.01,[0,1.0,0],'#06110a'),
        tube(helix([0,0.3,0],0.47,0.7,1.4,22),0.025,'#2d7a2d',{joints:false,seg:8}),
        ...[3,8,13,18].map(k=>{ const p=helix([0,0.3,0],0.47,0.7,1.4,22)[k]; return sph(0.08,[p[0]*1.08,p[1],p[2]*1.08],'#3fa34d',{sc:[1,0.3,1.6]}); }),
      ]),
      cyl(0.44,0.44,0.03,[0.95,0.03,0.85],'#d9c9a0',{seg:28}),
      ...seg,
    ];
  };
  T.warp_pipe.view = {yaw:0.35, pitch:0.4};

  /* The Royal Capital's single slow printing press: wooden frame, screw and
     bar, platen over the bed, the forme inked, the pamphlets stacked. */
  T.printing_press = (P)=>[
    box(1.6,0.12,1.0,[0,0.06,0],'frame'), box(0.14,1.9,0.14,[-0.6,1.0,-0.1],'frame'), box(0.14,1.9,0.14,[0.6,1.0,-0.1],'frame'),
    box(1.5,0.16,0.2,[0,2.0,-0.1],'frame'), box(1.5,0.12,0.16,[0,1.35,-0.1],'frame'),
    cyl(0.07,0.07,0.9,[0,1.6,-0.1],'iron'), ...[0,1,2,3,4,5].map(i=>tor(0.08,0.015,[0,1.42+i*0.09,-0.1],'iron',{r:[X,0,0],rings:6})),
    box(0.3,0.14,0.3,[0,1.35,-0.1],'iron'),
    cyl(0.03,0.03,1.3,[0,1.75,-0.1],'iron',{r:[0,0.4,X]}), sph(0.05,[-0.6,1.75,0.15],'iron'),
    box(0.8,0.08,0.6,[0,1.1,-0.1],'iron'),
    box(1.9,0.06,0.1,[0.2,0.56,0.3],'iron'), box(1.9,0.06,0.1,[0.2,0.56,-0.3],'iron'),
    box(1.0,0.1,0.7,[0.1,0.62,0.0],'iron'), box(0.6,0.03,0.45,[0.1,0.69,0],'ink'),
    box(0.62,0.01,0.5,[0.85,0.85,0],'paper',{r:[0,0,0.9]}), box(0.66,0.03,0.54,[0.86,0.84,0],'frame',{r:[0,0,0.9]}),
    box(0.45,0.16,0.32,[-0.95,0.14,0.35],'paper'), box(0.42,0.1,0.3,[-0.93,0.27,0.37],'paper',{r:[0,0.2,0]}),
    sph(0.08,[0.7,0.25,0.4],'ink'), bar3([0.7,0.25,0.4],[0.9,0.4,0.5],0.015,'frame'),
    gear(0.14,8,0.03,'iron',{p:[0.95,0.62,0.4],r:[X,0,0]}),
  ];
  T.printing_press.view = {yaw:0.55, pitch:0.25};

  /* Crashed Shroob technology under the Empire's salvage rig: a cracked
     saucer hull half in its crater, the core still glowing, cables out to a crate. */
  T.magitek_core = (P)=>[
    cyl(1.3,1.5,0.1,[0,0.05,0],'#3a2f44',{seg:36}),
    grp([0,0.42,0],[0.35,0.3,-0.15],[
      lathe([[0,-0.35],[0.5,-0.3],[1.0,-0.1],[1.15,0.0],[1.0,0.12],[0.6,0.3],[0.35,0.42]],[0,0,0],'shell',{seg:36}),
      tor(1.14,0.03,[0,0,0],'metal',{r:[X,0,0]}),
      ...[0,1,2,3,4,5].map(i=>sph(0.05,[Math.sin(ring(i,6))*0.8,0.14,Math.cos(ring(i,6))*0.8],'glow',{e:0.8})),
      sph(0.22,[0,0.35,0],'core',{e:1}), sph(0.3,[0,0.35,0],'core',{a:0.2,e:1}),
      tor(0.3,0.02,[0,0.35,0],'glow',{e:1,r:[0.4,0,0],spin:{axis:'y',speed:2}}),
      bar3([0,0.4,0],[0,1.3,0],0.25,'glow',{r2:0.12,a:0.12,e:1,caps:false,nb:true}),
    ]),
    ...[[1,1],[1,-1],[-1,1],[-1,-1]].map(([sx,sz])=>bar3([sx*1.1,0,sz*1.1],[sx*0.85,1.5,sz*0.85],0.035,'metal')),
    bar3([0.85,1.5,0.85],[-0.85,1.5,0.85],0.03,'metal'), bar3([-0.85,1.5,0.85],[-0.85,1.5,-0.85],0.03,'metal'),
    bar3([-0.85,1.5,-0.85],[0.85,1.5,-0.85],0.03,'metal'), bar3([0.85,1.5,-0.85],[0.85,1.5,0.85],0.03,'metal'),
    bar3([0,1.5,0.85],[0,1.5,-0.85],0.03,'metal'), bar3([0,1.5,0],[0,0.95,0],0.015,'#1a1a1a'), tor(0.08,0.015,[0,0.9,0],'metal',{rings:6}),
    box(0.3,0.1,0.2,[0.9,0.55,0.55],'metal',{r:[0.3,0.5,0]}), box(0.3,0.1,0.2,[-0.95,0.5,-0.4],'metal',{r:[-0.2,0.4,0]}),
    prism([[-0.2,0],[0.25,-0.05],[0.3,0.2],[0,0.3]],0.06,[1.5,0.12,-0.7],'shell',{r:[-X,0.4,0]}),
    prism([[-0.15,0],[0.2,0],[0.1,0.25]],0.06,[-1.4,0.12,0.9],'shell',{r:[-X,-0.6,0]}),
    tube([[0.6,0.6,0.6],[1.1,0.3,1.0],[1.5,0.12,1.2]],0.03,'#1a1a1a'),
    box(0.4,0.3,0.3,[1.7,0.15,1.3],'metal'), sph(0.09,[1.7,0.38,1.3],'core',{e:1}),
  ];
  T.magitek_core.view = {yaw:0.6, pitch:0.4};

  /* The Star Sprite reactor: four columns round a glowing core wound in coils,
     the star shard above it, sprites circling. */
  T.reactor = (P)=>[
    cyl(0.9,1.0,0.2,[0,0.1,0],'frame',{seg:32}), tor(0.92,0.03,[0,0.2,0],'coil',{r:[X,0,0]}),
    ...[[1,1],[1,-1],[-1,1],[-1,-1]].map(([sx,sz])=>cyl(0.08,0.08,2.0,[sx*0.6,1.2,sz*0.6],'frame')),
    tor(0.85,0.05,[0,2.25,0],'frame',{r:[X,0,0]}),
    ...[[1,1],[1,-1],[-1,1],[-1,-1]].map(([sx,sz])=>bar3([sx*0.6,0.25,sz*0.6],[0,0.3,0],0.03,'coil')),
    cyl(0.2,0.25,0.9,[0,0.65,0],'frame'),
    sph(0.32,[0,1.45,0],'core',{e:1}), sph(0.42,[0,1.45,0],'glow',{a:0.22,e:1}),
    tor(0.5,0.05,[0,1.15,0],'coil',{r:[X,0,0]}), tor(0.55,0.05,[0,1.45,0],'coil',{r:[X,0,0]}), tor(0.5,0.05,[0,1.75,0],'coil',{r:[X,0,0]}),
    tor(0.62,0.015,[0,1.45,0],'glow',{e:1,r:[X+0.4,0,0],spin:{axis:'z',speed:1.1}}),
    cyl(0.04,0.04,0.9,[0,2.1,0],'glow',{a:0.4,e:1}),
    star4(0.28,0.05,[0,2.65,0],'glow',{e:1,spin:{axis:'y',speed:1.2}}), star4(0.16,0.05,[0,2.65,0],'#ffffff',{e:1,r:[0,X,0],spin:{axis:'y',speed:1.2}}),
    grp([0,1.45,0],null,[sph(0.06,[0.75,0.2,0],'glow',{e:1}), sph(0.05,[-0.7,-0.1,0.3],'glow',{e:1}), sph(0.05,[0.1,0.3,-0.75],'glow',{e:1})],{spin:{axis:'y',speed:0.7}}),
  ];
  T.reactor.view = {yaw:0.5, pitch:0.2};

  /* Fawful's vacuum shroom: a red-capped mushroom whose stem is a hose into a
     nozzle, with the fat vial beside it. Explained at the Bean Badge, 955 BF. */
  T.vacuum_shroom = (P)=>[
    sph(0.5,[0,0.95,0],'cap',{sc:[1,0.62,1]}), cyl(0.5,0.5,0.08,[0,0.8,0],'cap'),
    ...[0,1,2,3,4].map(i=>sph(0.1,[Math.sin(ring(i,5))*0.3,1.05+(i%2)*0.06,Math.cos(ring(i,5))*0.3],'spots',{sc:[1,0.5,1]})),
    lathe([[0,0],[0.2,0],[0.24,0.2],[0.2,0.5],[0.22,0.78],[0,0.8]],[0,0,0],'stem',{seg:24}),
    tube([[0.15,0.15,0.1],[0.6,0.1,0.3],[0.95,0.3,0.35],[1.05,0.65,0.25]],0.05,'hose'),
    bar3([1.05,0.65,0.25],[1.15,0.95,0.2],0.09,'nozzle',{r2:0.06}),
    lathe([[0,0],[0.26,0],[0.3,0.12],[0.3,0.34],[0.14,0.46],[0.1,0.6],[0,0.6]],[-0.75,0,0.1],'vial',{seg:24}),
    cyl(0.1,0.1,0.06,[-0.75,0.63,0.1],'nozzle'),
  ];
  T.vacuum_shroom.view = {yaw:0.5, pitch:0.3};

  /* The Guild's small orb: a fist-sized sphere with a bright core, a metal
     band, held up in a gloved hand. One use, one Koopa King down. */
  T.guild_orb = (P)=>[
    sph(0.32,[0,0.95,0],'orb',{a:0.85}), sph(0.14,[0,0.95,0],'core',{e:0.6}),
    tor(0.33,0.025,[0,0.95,0],'band',{r:[X,0,0]}), tor(0.33,0.025,[0,0.95,0],'band',{r:[0,0,X]}),
    lathe([[0,0],[0.22,0],[0.26,0.3],[0.2,0.55],[0.1,0.6],[0,0.6]],[0,0.05,0],'hand',{seg:20}),
    ...[0,1,2,3].map(i=>cyl(0.045,0.04,0.3,[Math.sin(ring(i,4)+0.4)*0.22,0.7,Math.cos(ring(i,4)+0.4)*0.22],'hand',{r:[Math.cos(ring(i,4)+0.4)*0.5,0,-Math.sin(ring(i,4)+0.4)*0.5]})),
  ];
  T.guild_orb.view = {yaw:0.4, pitch:0.25};

  /* Wario's motorbike: two fat tyres, a purple frame, the yellow tank with the W,
     a low seat, forks and bars, one lamp. Front wheel +X. The thing has been
     stalled, crashed and sat on; the wheels turn anyway. */
  T.motorbike = (P)=>[
    grp([0,0,0],null,[
      grp([0.72,0.36,0],null,[tor(0.3,0.1,[0,0,0],'tyre',{r:[X,0,0]}), cyl(0.2,0.2,0.08,[0,0,0],'metal',{r:[X,0,0]})],{spin:{axis:'z',speed:-6}}),
      grp([-0.72,0.36,0],null,[tor(0.3,0.1,[0,0,0],'tyre',{r:[X,0,0]}), cyl(0.2,0.2,0.08,[0,0,0],'metal',{r:[X,0,0]})],{spin:{axis:'z',speed:-6}}),
      bar2([-0.6,0.42],[0.1,0.9],0.07,'frame',{depth:0.1}), bar2([0.1,0.9],[0.6,0.5],0.07,'frame',{depth:0.1}),
      bar2([-0.6,0.42],[0.5,0.42],0.07,'frame',{depth:0.1}),
      bar2([0.52,0.44],[0.78,1.02],0.05,'metal',{depth:0.05, z:0.08}), bar2([0.52,0.44],[0.78,1.02],0.05,'metal',{depth:0.05, z:-0.08}),
      sph(0.3,[0.05,1.0,0],'tank',{sc:[1.5,0.75,0.9]}), letters('W',0.03,[0.05,1.0,0.3],'#5a2d82'),
      box(0.55,0.1,0.3,[-0.45,0.92,0],'seat'), box(0.1,0.22,0.3,[-0.75,0.98,0],'seat'),
      cyl(0.03,0.03,0.6,[0.8,1.08,0],'metal',{r:[X,0,0]}), sph(0.05,[0.8,1.08,0.32],'#2a2a2a'), sph(0.05,[0.8,1.08,-0.32],'#2a2a2a'),
      sph(0.12,[0.95,0.86,0],'lamp',{e:0.5}),
      box(0.4,0.3,0.3,[-0.1,0.5,0],'metal'), cyl(0.05,0.05,0.9,[-0.45,0.4,0.2],'metal',{r:[0,0,X*0.95]}),
      cyl(0.04,0.04,0.4,[-0.05,0.3,0.25],'metal',{r:[X,0,0]}), cyl(0.04,0.04,0.4,[-0.05,0.3,-0.25],'metal',{r:[X,0,0]}),
    ],{bob:{amp:0.015,speed:9}}),
  ];
  T.motorbike.view = {yaw:0.55, pitch:0.22};

  /* The electric sphere Eager carried out of the grove: a glass sphere in a
     metal cage with a core that will not stop humming, on a three-foot stand. */
  T.charged_sphere = (P)=>[
    lathe([[0,0],[0.3,0],[0.32,0.06],[0.12,0.1],[0.1,0.42],[0.26,0.5],[0,0.5]],[0,0,0],'shell',{seg:24}),
    grp([0,0.98,0],null,[
      sph(0.42,[0,0,0],'glass',{a:0.45}), sph(0.16,[0,0,0],'core',{e:0.9}),
      ...[0,1,2,3,4,5].map(i=>sph(0.04,[Math.sin(ring(i,6))*0.3,Math.cos(ring(i,6)*2)*0.12,Math.cos(ring(i,6))*0.3],'arc',{e:0.8})),
      tor(0.44,0.025,[0,0,0],'band',{r:[X,0,0]}), tor(0.44,0.025,[0,0,0],'band',{r:[0,0,X]}), tor(0.44,0.025,[0,0,0],'band'),
    ],{spin:{axis:'y',speed:0.8}, bob:{amp:0.03,speed:1.6}}),
    ...[0,1,2].map(i=>cyl(0.03,0.03,0.4,[Math.sin(ring(i,3))*0.26,0.6,Math.cos(ring(i,3))*0.26],'shell',{r:[Math.cos(ring(i,3))*0.35,0,-Math.sin(ring(i,3))*0.35]})),
  ];
  T.charged_sphere.view = {yaw:0.4, pitch:0.25};

  /* ---------- builder ---------- */
  /* Resolve palette keys to colours (recursively through groups) and hand the
     part list to the renderer in tech-gl.js, which returns a compiled model
     { root, leaves, center, radius, view } for TECH_GL.renderSoft / TECH_GL.mount. */
  function resolve(parts, P){
    return parts.map(part=>{
      const out = Object.assign({}, part);
      if(part.parts) out.parts = resolve(part.parts, P);
      else out.c = (part.c && part.c[0]==='#') ? part.c : (P[part.c] || '#8d8d99');
      return out;
    });
  }
  function parts(name, palette){
    const recipe = T[name] || T.radio;
    const P = Object.assign({}, palette||{});
    return resolve(recipe(P), P);
  }
  function build(name, palette, opts){
    const GL = window.TECH_GL;
    if(!GL) throw new Error('tech-gl.js must load before tech-models.js builds');
    const recipe = T[name] || T.radio;
    return GL.compile(parts(name, palette), Object.assign({ view: recipe.view || null }, opts||{}));
  }

  window.TECH_MODELS = { recipes: T, names: Object.keys(T), parts, build };
})();
