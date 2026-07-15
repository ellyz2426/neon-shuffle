import {
  createSystem,
  PanelUI,
  PanelDocument,
  UIKitDocument,
  UIKit,
  eq,
  World,
  Follower,
  ScreenSpace,
  InputComponent,
  Mesh,
  Group,
  BoxGeometry,
  SphereGeometry,
  CylinderGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  LineBasicMaterial,
  Color,
  Vector3,
  Vector2,
  Raycaster,
  AmbientLight,
  PointLight,
  DirectionalLight,
  Fog,
  BufferGeometry,
  Float32BufferAttribute,
  LineSegments,
  EdgesGeometry,
  AdditiveBlending,
  Object3D,
} from '@iwsdk/core';

// ===== CONSTANTS =====
const TABLE_Y = 1.0;
const TABLE_LEN = 5.0;
const TABLE_W = 0.6;
const TABLE_HW = TABLE_W / 2;
const TABLE_START_Z = 0;
const TABLE_END_Z = -TABLE_LEN;
const LAUNCH_Z = -0.3;
const ZONE_START = -1.0;
const ZONE_LEN = 1.0;
const PUCK_R = 0.038;
const PUCK_H = 0.018;
const RAIL_H = 0.04;
const RAIL_W = 0.025;
const FRICTION = 1.8;
const MIN_SPEED = 0.003;
const MAX_POWER = 6.0;
const POWER_RATE = 0.6;
const BOUNCE_DAMP = 0.4;
const PUCKS_PER_ROUND = 4;
const TOTAL_ROUNDS = 4;
const PLAYER_COLOR = 0x00ccff;
const AI_COLOR = 0xff3388;
const ZONE_COLORS = [0x2244aa, 0x22aa44, 0xaaaa22, 0xcc4422];
const ZONE_POINTS = [1, 2, 3, 4];
const DIFF_NAMES = ['EASY', 'NORMAL', 'HARD'] as const;
const DIFF_VARIANCE = [0.15, 0.08, 0.03];
const DIFF_AIM_ERR = [0.12, 0.06, 0.02];

// ===== TYPES =====
enum GS { MENU, MODE_SELECT, TUTORIAL, SETUP, PLAYER_AIM, PLAYER_SLIDE, AI_THINK, AI_SLIDE, ROUND_SCORE, GAME_OVER, PAUSE, SETTINGS, ACHIEVEMENTS }
enum GM { CLASSIC, TARGET, SURVIVAL, TIME_TRIAL }
const MODE_NAMES = ['CLASSIC', 'TARGET', 'SURVIVAL', 'TIME TRIAL'];

interface Puck {
  mesh: Mesh;
  glow: Mesh;
  x: number;
  z: number;
  vx: number;
  vz: number;
  active: boolean;
  settled: boolean;
  isPlayer: boolean;
  idx: number;
}

interface SaveData {
  gamesPlayed: number;
  gamesWon: number;
  totalScore: number;
  bestScore: number;
  bestRound: number;
  knockoffs: number;
  zone4Hits: number;
  perfectRounds: number;
  streak: number;
  bestStreak: number;
  survivalBest: number;
  timeTrialBest: number;
  difficulty: number;
  sfxVol: number;
  musicVol: number;
  achievements: boolean[];
}

const ACH = [
  'First Slide - Score your first point',
  'Bullseye - Land a puck in Zone 4',
  'Full House - Score with all 4 pucks',
  'Knockoff - Knock opponent puck off table',
  'Sharpshooter - 3 Zone 4 hits in a round',
  'Victory - Win your first game',
  'Domination - Win by 15+ points',
  'Comeback King - Win after trailing by 8+',
  'Hot Streak x3 - Win 3 in a row',
  'Hot Streak x5 - Win 5 in a row',
  'Perfect Round - Max score in a round',
  'Score 100 - Reach 100 career points',
  'Score 500 - Reach 500 career points',
  'Veteran - Play 10 games',
  'Dedicated - Play 25 games',
  'Hard Hitter - Beat Hard AI',
  'Flawless - Win Hard without AI scoring',
  'Survivor 10 - Survive 10 rounds',
  'Time Lord - 25+ points in Time Trial',
  'Table Master - All modes played',
];

// ===== GAME SYSTEM =====
export class GameSystem extends createSystem({
  menuPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/menu.json')] },
  modePanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/mode-select.json')] },
  hudPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/hud.json')] },
  gameoverPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/gameover.json')] },
  settingsPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/settings.json')] },
  pausePanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/pause.json')] },
  achPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/achievements.json')] },
  tutPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/tutorial.json')] },
}) {
  private w!: World;
  private state = GS.MENU;
  private prevState = GS.MENU;
  private mode = GM.CLASSIC;
  private difficulty = 1;

  // Panels
  private panelEntities: Record<string, any> = {};
  private docs: Record<string, UIKitDocument> = {};
  private panelsReady = 0;

  // Game state
  private round = 0;
  private playerScore = 0;
  private aiScore = 0;
  private playerRoundScore = 0;
  private aiRoundScore = 0;
  private playerPucksUsed = 0;
  private aiPucksUsed = 0;
  private isPlayerTurn = true;
  private pucks: Puck[] = [];
  private turnPuck: Puck | null = null;

  // Aim/power
  private aimAngle = 0;
  private power = 0;
  private charging = false;
  private aimGroup!: Group;
  private aimArrow!: Mesh;
  private powerBar!: Mesh;
  private powerBarBg!: Mesh;

  // AI
  private aiThinkTimer = 0;
  private aiTargetX = 0;
  private aiTargetPower = 0;

  // Timer (time trial)
  private gameTimer = 0;
  private timeTrialDuration = 60;

  // Survival
  private survivalRound = 0;
  private survivalMinScore = 0;

  // Environment
  private tableGroup!: Group;
  private arenaGroup!: Group;
  private zoneMeshes: Mesh[] = [];

  // Scoring animations
  private scorePopups: { mesh: Mesh; life: number }[] = [];
  private trailParticles: { mesh: Mesh; life: number }[] = [];

  // Audio
  private audioCtx: AudioContext | null = null;

  // Save data
  private save: SaveData = {
    gamesPlayed: 0, gamesWon: 0, totalScore: 0, bestScore: 0, bestRound: 0,
    knockoffs: 0, zone4Hits: 0, perfectRounds: 0, streak: 0, bestStreak: 0,
    survivalBest: 0, timeTrialBest: 0, difficulty: 1, sfxVol: 80, musicVol: 50,
    achievements: new Array(20).fill(false),
  };

  // Music
  private musicOsc: OscillatorNode | null = null;
  private musicGain: GainNode | null = null;
  private musicPlaying = false;

  // Modes played tracker
  private modesPlayed = new Set<GM>();

  // Trailing flag for comeback achievement
  private wasTrailing = false;
  private trailAmount = 0;

  // Flawless tracking
  private aiScoredThisGame = false;

  init() {
    this.w = this.world as World;
    this.loadSave();
    this.difficulty = this.save.difficulty;
    this.createEnvironment();
    this.createAimIndicator();
    this.createPanels();
    this.initAudio();
    this.showAim(false);
  }

  // ===== ENVIRONMENT =====
  private createEnvironment() {
    // Arena
    this.arenaGroup = new Group();
    this.w.scene.add(this.arenaGroup);

    // Floor
    const floor = new Mesh(
      new BoxGeometry(20, 0.01, 20),
      new MeshStandardMaterial({ color: 0x0a0a1a, metalness: 0.8, roughness: 0.3 }),
    );
    floor.position.set(0, 0, -2.5);
    this.arenaGroup.add(floor);

    // Floor grid
    const gridGeo = new BufferGeometry();
    const gridVerts: number[] = [];
    for (let i = -10; i <= 10; i++) {
      gridVerts.push(i, 0.011, -12.5, i, 0.011, 7.5);
      gridVerts.push(-10, 0.011, i - 2.5, 10, 0.011, i - 2.5);
    }
    gridGeo.setAttribute('position', new Float32BufferAttribute(gridVerts, 3));
    const grid = new LineSegments(gridGeo, new LineBasicMaterial({ color: 0x111133, transparent: true, opacity: 0.4 }));
    this.arenaGroup.add(grid);

    // Lights
    const ambient = new AmbientLight(0x222244, 0.4);
    this.w.scene.add(ambient);

    const mainLight = new DirectionalLight(0xaabbff, 0.6);
    mainLight.position.set(2, 5, 2);
    this.w.scene.add(mainLight);

    const spotCyan = new PointLight(0x00ccff, 1.5, 8);
    spotCyan.position.set(-1.5, 3, -2.5);
    this.w.scene.add(spotCyan);

    const spotMagenta = new PointLight(0xff3388, 1.0, 8);
    spotMagenta.position.set(1.5, 3, -2.5);
    this.w.scene.add(spotMagenta);

    const tableSpot = new PointLight(0xffffff, 0.8, 6);
    tableSpot.position.set(0, 3, -2.5);
    this.w.scene.add(tableSpot);

    this.w.scene.fog = new Fog(0x050510, 5, 18);

    // Table
    this.tableGroup = new Group();
    this.tableGroup.position.set(0, TABLE_Y, 0);
    this.w.scene.add(this.tableGroup);

    // Table surface
    const surface = new Mesh(
      new BoxGeometry(TABLE_W, 0.03, TABLE_LEN),
      new MeshStandardMaterial({ color: 0x0d1a2a, metalness: 0.5, roughness: 0.6 }),
    );
    surface.position.set(0, 0, -TABLE_LEN / 2);
    this.tableGroup.add(surface);

    // Table legs
    const legGeo = new CylinderGeometry(0.03, 0.03, TABLE_Y, 8);
    const legMat = new MeshStandardMaterial({ color: 0x222244, metalness: 0.7, roughness: 0.3 });
    const legPositions = [
      [-TABLE_HW + 0.05, -TABLE_Y / 2, -0.2],
      [TABLE_HW - 0.05, -TABLE_Y / 2, -0.2],
      [-TABLE_HW + 0.05, -TABLE_Y / 2, -TABLE_LEN + 0.2],
      [TABLE_HW - 0.05, -TABLE_Y / 2, -TABLE_LEN + 0.2],
    ];
    for (const [lx, ly, lz] of legPositions) {
      const leg = new Mesh(legGeo, legMat);
      leg.position.set(lx, ly, lz);
      this.tableGroup.add(leg);
    }

    // Rails
    const railMat = new MeshStandardMaterial({ color: 0x1a2a44, metalness: 0.6, roughness: 0.4, emissive: new Color(0x112244), emissiveIntensity: 0.3 });
    const sideRailGeo = new BoxGeometry(RAIL_W, RAIL_H, TABLE_LEN);
    const leftRail = new Mesh(sideRailGeo, railMat);
    leftRail.position.set(-TABLE_HW - RAIL_W / 2, RAIL_H / 2 + 0.015, -TABLE_LEN / 2);
    this.tableGroup.add(leftRail);
    const rightRail = new Mesh(sideRailGeo, railMat);
    rightRail.position.set(TABLE_HW + RAIL_W / 2, RAIL_H / 2 + 0.015, -TABLE_LEN / 2);
    this.tableGroup.add(rightRail);

    // Back rail (near end, behind launch)
    const backRailGeo = new BoxGeometry(TABLE_W + RAIL_W * 2, RAIL_H, RAIL_W);
    const backRail = new Mesh(backRailGeo, railMat);
    backRail.position.set(0, RAIL_H / 2 + 0.015, RAIL_W / 2);
    this.tableGroup.add(backRail);

    // Zone markings
    for (let i = 0; i < 4; i++) {
      const zoneZ = ZONE_START - i * ZONE_LEN;
      const zoneMesh = new Mesh(
        new BoxGeometry(TABLE_W - 0.02, 0.002, ZONE_LEN - 0.01),
        new MeshStandardMaterial({
          color: ZONE_COLORS[i],
          transparent: true,
          opacity: 0.15,
          emissive: new Color(ZONE_COLORS[i]),
          emissiveIntensity: 0.4,
        }),
      );
      zoneMesh.position.set(0, 0.016, zoneZ - ZONE_LEN / 2);
      this.tableGroup.add(zoneMesh);
      this.zoneMeshes.push(zoneMesh);

      // Zone divider line
      if (i > 0) {
        const lineGeo = new BufferGeometry();
        lineGeo.setAttribute('position', new Float32BufferAttribute([
          -TABLE_HW + 0.01, 0.017, zoneZ,
          TABLE_HW - 0.01, 0.017, zoneZ,
        ], 3));
        const line = new LineSegments(lineGeo, new LineBasicMaterial({
          color: ZONE_COLORS[i], transparent: true, opacity: 0.6,
        }));
        this.tableGroup.add(line);
      }
    }

    // Launch line
    const launchLineGeo = new BufferGeometry();
    launchLineGeo.setAttribute('position', new Float32BufferAttribute([
      -TABLE_HW + 0.01, 0.017, ZONE_START,
      TABLE_HW - 0.01, 0.017, ZONE_START,
    ], 3));
    const launchLine = new LineSegments(launchLineGeo, new LineBasicMaterial({
      color: 0x00ccff, transparent: true, opacity: 0.8,
    }));
    this.tableGroup.add(launchLine);

    // Far end line (off table boundary)
    const endLineGeo = new BufferGeometry();
    endLineGeo.setAttribute('position', new Float32BufferAttribute([
      -TABLE_HW + 0.01, 0.017, TABLE_END_Z,
      TABLE_HW - 0.01, 0.017, TABLE_END_Z,
    ], 3));
    const endLine = new LineSegments(endLineGeo, new LineBasicMaterial({
      color: 0xff2244, transparent: true, opacity: 0.8,
    }));
    this.tableGroup.add(endLine);

    // Center line (decorative)
    const centerLineGeo = new BufferGeometry();
    centerLineGeo.setAttribute('position', new Float32BufferAttribute([
      0, 0.017, TABLE_START_Z - 0.1,
      0, 0.017, TABLE_END_Z + 0.1,
    ], 3));
    const centerLine = new LineSegments(centerLineGeo, new LineBasicMaterial({
      color: 0x223355, transparent: true, opacity: 0.3,
    }));
    this.tableGroup.add(centerLine);

    // Decorative corner lights on table
    const cornerLightGeo = new SphereGeometry(0.015, 8, 8);
    const cornerLightMat = new MeshBasicMaterial({ color: 0x00ccff });
    const corners = [
      [-TABLE_HW, 0.03, 0], [TABLE_HW, 0.03, 0],
      [-TABLE_HW, 0.03, TABLE_END_Z], [TABLE_HW, 0.03, TABLE_END_Z],
    ];
    for (const [cx, cy, cz] of corners) {
      const cl = new Mesh(cornerLightGeo, cornerLightMat);
      cl.position.set(cx, cy, cz);
      this.tableGroup.add(cl);
    }

    // Ambient pillars around arena
    const pillarGeo = new CylinderGeometry(0.08, 0.08, 4, 6);
    const pillarMat = new MeshStandardMaterial({ color: 0x111133, emissive: new Color(0x0a0a22), emissiveIntensity: 0.5 });
    const pillarPositions = [
      [-3, 2, -2.5], [3, 2, -2.5], [-3, 2, 1], [3, 2, 1],
      [-3, 2, -6], [3, 2, -6],
    ];
    for (const [px, py, pz] of pillarPositions) {
      const pillar = new Mesh(pillarGeo, pillarMat);
      pillar.position.set(px, py, pz);
      this.arenaGroup.add(pillar);
      // Pillar light strip
      const strip = new Mesh(
        new BoxGeometry(0.01, 3.5, 0.01),
        new MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.4 }),
      );
      strip.position.set(px, py, pz);
      this.arenaGroup.add(strip);
    }
  }

  // ===== AIM INDICATOR =====
  private createAimIndicator() {
    this.aimGroup = new Group();
    this.aimGroup.position.set(0, TABLE_Y + 0.02, LAUNCH_Z);
    this.w.scene.add(this.aimGroup);

    // Arrow shaft
    this.aimArrow = new Mesh(
      new BoxGeometry(0.008, 0.004, 0.4),
      new MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.8 }),
    );
    this.aimArrow.position.set(0, 0, -0.25);
    this.aimGroup.add(this.aimArrow);

    // Arrow head
    const head = new Mesh(
      new CylinderGeometry(0, 0.02, 0.06, 4),
      new MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.8 }),
    );
    head.rotation.x = -Math.PI / 2;
    head.position.set(0, 0, -0.48);
    this.aimGroup.add(head);

    // Power bar background
    this.powerBarBg = new Mesh(
      new BoxGeometry(0.18, 0.004, 0.016),
      new MeshBasicMaterial({ color: 0x222244, transparent: true, opacity: 0.6 }),
    );
    this.powerBarBg.position.set(0, 0, 0.08);
    this.aimGroup.add(this.powerBarBg);

    // Power bar fill
    this.powerBar = new Mesh(
      new BoxGeometry(0.001, 0.005, 0.014),
      new MeshBasicMaterial({ color: 0x00ff44 }),
    );
    this.powerBar.position.set(-0.089, 0.001, 0.08);
    this.aimGroup.add(this.powerBar);
  }

  private showAim(visible: boolean) {
    this.aimGroup.visible = visible;
  }

  private updateAimVisual() {
    this.aimGroup.rotation.y = this.aimAngle;
    // Power bar
    const pFrac = this.power;
    const barW = 0.178 * pFrac;
    (this.powerBar.geometry as any).dispose();
    this.powerBar.geometry = new BoxGeometry(Math.max(barW, 0.001), 0.005, 0.014);
    this.powerBar.position.x = -0.089 + barW / 2;

    // Color shift green -> yellow -> red
    const r = pFrac < 0.5 ? pFrac * 2 : 1;
    const g = pFrac < 0.5 ? 1 : 1 - (pFrac - 0.5) * 2;
    (this.powerBar.material as MeshBasicMaterial).color.setRGB(r, g, 0);
  }

  // ===== PUCKS =====
  private createPuck(isPlayer: boolean, idx: number): Puck {
    const color = isPlayer ? PLAYER_COLOR : AI_COLOR;
    const mesh = new Mesh(
      new CylinderGeometry(PUCK_R, PUCK_R, PUCK_H, 24),
      new MeshStandardMaterial({
        color,
        metalness: 0.7,
        roughness: 0.2,
        emissive: new Color(color),
        emissiveIntensity: 0.5,
      }),
    );

    // Glow ring
    const glow = new Mesh(
      new CylinderGeometry(PUCK_R + 0.005, PUCK_R + 0.005, 0.003, 24),
      new MeshBasicMaterial({ color, transparent: true, opacity: 0.3 }),
    );
    glow.position.y = -PUCK_H / 2 + 0.002;
    mesh.add(glow);

    // Edge ring
    const edgeGeo = new EdgesGeometry(new CylinderGeometry(PUCK_R + 0.001, PUCK_R + 0.001, PUCK_H + 0.001, 24));
    const edge = new LineSegments(edgeGeo, new LineBasicMaterial({ color, transparent: true, opacity: 0.6 }));
    mesh.add(edge);

    mesh.visible = false;
    this.w.scene.add(mesh);

    return {
      mesh,
      glow,
      x: 0, z: LAUNCH_Z,
      vx: 0, vz: 0,
      active: false,
      settled: true,
      isPlayer,
      idx,
    };
  }

  private positionPuck(p: Puck) {
    p.mesh.position.set(p.x, TABLE_Y + PUCK_H / 2 + 0.016, p.z);
  }

  private removePuckFromTable(p: Puck) {
    p.active = false;
    p.settled = true;
    p.mesh.visible = false;
    // Knockoff tracking
    if (p.isPlayer) {
      // AI knocked off player puck
    } else {
      this.save.knockoffs++;
      this.unlock(3); // Knockoff achievement
    }
  }

  // ===== PANELS =====
  private createPanels() {
    // [key, config, x, y, z, visible]
    const panels: [string, string, number, number, number, boolean][] = [
      ['menu', './ui/menu.json', 0, 2.0, -1.5, true],
      ['mode', './ui/mode-select.json', 0, 2.0, -1.5, false],
      ['hud', './ui/hud.json', 0, 2.0, -1.5, false],
      ['gameover', './ui/gameover.json', 0, 2.0, -1.5, false],
      ['settings', './ui/settings.json', 0, 2.0, -1.5, false],
      ['pause', './ui/pause.json', 0, 2.0, -1.5, false],
      ['ach', './ui/achievements.json', 0, 2.0, -1.5, false],
      ['tut', './ui/tutorial.json', 0, 2.0, -1.5, false],
    ];

    for (const [key, config, x, y, z, visible] of panels) {
      const entity = this.w.createTransformEntity(undefined, { persistent: true });
      entity.addComponent(PanelUI, { config });
      // Rotate panel to face camera (panels face +Z by default, camera is at +Z)
      entity.object3D!.rotation.set(-0.4, 0, 0); // tilt slightly toward camera above
      if (visible) {
        entity.object3D!.position.set(x, y, z);
        entity.object3D!.visible = true;
      } else {
        entity.object3D!.position.set(x, -100, z);
        entity.object3D!.visible = false;
      }
      this.panelEntities[key] = entity;
    }

    // Wire qualify events
    this.queries.menuPanel.subscribe('qualify', (e) => this.wirePanel('menu', e));
    this.queries.modePanel.subscribe('qualify', (e) => this.wirePanel('mode', e));
    this.queries.hudPanel.subscribe('qualify', (e) => this.wirePanel('hud', e));
    this.queries.gameoverPanel.subscribe('qualify', (e) => this.wirePanel('gameover', e));
    this.queries.settingsPanel.subscribe('qualify', (e) => this.wirePanel('settings', e));
    this.queries.pausePanel.subscribe('qualify', (e) => this.wirePanel('pause', e));
    this.queries.achPanel.subscribe('qualify', (e) => this.wirePanel('ach', e));
    this.queries.tutPanel.subscribe('qualify', (e) => this.wirePanel('tut', e));
  }

  private wirePanel(key: string, entity: any) {
    const doc = entity.getValue(PanelDocument, 'document') as UIKitDocument;
    if (!doc) return;
    this.docs[key] = doc;
    this.panelsReady++;

    if (key === 'menu') {
      this.btn(doc, 'btn-play', () => this.changeState(GS.MODE_SELECT));
      this.btn(doc, 'btn-tutorial', () => this.changeState(GS.TUTORIAL));
      this.btn(doc, 'btn-settings', () => this.changeState(GS.SETTINGS));
      this.btn(doc, 'btn-achievements', () => this.changeState(GS.ACHIEVEMENTS));
      this.updateMenuStats();
    }
    if (key === 'mode') {
      this.btn(doc, 'btn-classic', () => this.startGame(GM.CLASSIC));
      this.btn(doc, 'btn-target', () => this.startGame(GM.TARGET));
      this.btn(doc, 'btn-survival', () => this.startGame(GM.SURVIVAL));
      this.btn(doc, 'btn-timetrial', () => this.startGame(GM.TIME_TRIAL));
      this.btn(doc, 'btn-mode-back', () => this.changeState(GS.MENU));
      this.btn(doc, 'btn-diff-down', () => this.cycleDifficulty(-1));
      this.btn(doc, 'btn-diff-up', () => this.cycleDifficulty(1));
    }
    if (key === 'gameover') {
      this.btn(doc, 'btn-rematch', () => this.startGame(this.mode));
      this.btn(doc, 'btn-go-menu', () => this.changeState(GS.MENU));
    }
    if (key === 'settings') {
      this.btn(doc, 'btn-sfx-down', () => this.adjustVol('sfx', -10));
      this.btn(doc, 'btn-sfx-up', () => this.adjustVol('sfx', 10));
      this.btn(doc, 'btn-mus-down', () => this.adjustVol('mus', -10));
      this.btn(doc, 'btn-mus-up', () => this.adjustVol('mus', 10));
      this.btn(doc, 'btn-set-back', () => this.changeState(this.prevState === GS.PAUSE ? GS.PAUSE : GS.MENU));
      this.updateSettingsUI();
    }
    if (key === 'pause') {
      this.btn(doc, 'btn-resume', () => this.changeState(GS.PLAYER_AIM));
      this.btn(doc, 'btn-p-settings', () => { this.prevState = GS.PAUSE; this.changeState(GS.SETTINGS); });
      this.btn(doc, 'btn-quit', () => this.changeState(GS.MENU));
    }
    if (key === 'ach') {
      this.btn(doc, 'btn-ach-back', () => this.changeState(GS.MENU));
      this.updateAchUI();
    }
    if (key === 'tut') {
      this.btn(doc, 'btn-tut-back', () => this.changeState(GS.MENU));
    }
  }

  private btn(doc: UIKitDocument, id: string, cb: () => void) {
    const el = doc.getElementById(id) as UIKit.Text | undefined;
    el?.addEventListener('click', cb);
  }

  private txt(key: string, id: string, text: string) {
    const doc = this.docs[key];
    if (!doc) return;
    const el = doc.getElementById(id) as UIKit.Text | undefined;
    el?.setProperties({ text });
  }

  // ===== PANEL VISIBILITY =====
  private showPanel(key: string) {
    const entity = this.panelEntities[key];
    if (!entity) return;
    if (key === 'hud') {
      // HUD uses ScreenSpace for overlay
      if (!entity.hasComponent(ScreenSpace)) {
        entity.addComponent(Follower, { target: this.w.player.head });
        entity.addComponent(ScreenSpace, {});
      }
    } else {
      entity.object3D!.position.set(0, 2.0, -1.5);
      entity.object3D!.visible = true;
    }
  }

  private hidePanel(key: string) {
    const entity = this.panelEntities[key];
    if (!entity) return;
    if (key === 'hud') {
      if (entity.hasComponent(ScreenSpace)) entity.removeComponent(ScreenSpace);
      if (entity.hasComponent(Follower)) entity.removeComponent(Follower);
    } else {
      entity.object3D!.position.set(0, -100, -1.5);
      entity.object3D!.visible = false;
    }
  }

  private showOnlyPanel(key: string) {
    const all = ['menu', 'mode', 'hud', 'gameover', 'settings', 'pause', 'ach', 'tut'];
    for (const k of all) {
      if (k === key) this.showPanel(k);
      else this.hidePanel(k);
    }
  }

  // ===== STATE MACHINE =====
  private changeState(newState: GS) {
    this.prevState = this.state;
    this.state = newState;

    switch (newState) {
      case GS.MENU:
        this.showOnlyPanel('menu');
        this.showAim(false);
        this.clearPucks();
        this.updateMenuStats();
        break;
      case GS.MODE_SELECT:
        this.showOnlyPanel('mode');
        this.updateModeUI();
        break;
      case GS.TUTORIAL:
        this.showOnlyPanel('tut');
        break;
      case GS.SETTINGS:
        this.showOnlyPanel('settings');
        this.updateSettingsUI();
        break;
      case GS.ACHIEVEMENTS:
        this.showOnlyPanel('ach');
        this.updateAchUI();
        break;
      case GS.SETUP:
        this.setupGame();
        break;
      case GS.PLAYER_AIM:
        this.showOnlyPanel('hud');
        this.showAim(true);
        this.preparePlayerPuck();
        break;
      case GS.PLAYER_SLIDE:
        this.showAim(false);
        break;
      case GS.AI_THINK:
        this.showAim(false);
        this.aiThinkTimer = 0.8 + Math.random() * 0.5;
        this.planAIShot();
        break;
      case GS.AI_SLIDE:
        break;
      case GS.ROUND_SCORE:
        this.scoreRound();
        break;
      case GS.GAME_OVER:
        this.endGame();
        break;
      case GS.PAUSE:
        this.showOnlyPanel('pause');
        break;
    }
  }

  // ===== GAME SETUP =====
  private startGame(mode: GM) {
    this.mode = mode;
    this.modesPlayed.add(mode);
    if (this.modesPlayed.size >= 4) this.unlock(19);
    this.changeState(GS.SETUP);
  }

  private setupGame() {
    this.round = 1;
    this.playerScore = 0;
    this.aiScore = 0;
    this.playerPucksUsed = 0;
    this.aiPucksUsed = 0;
    this.isPlayerTurn = true;
    this.wasTrailing = false;
    this.trailAmount = 0;
    this.aiScoredThisGame = false;
    this.survivalRound = 1;
    this.survivalMinScore = 3;
    this.gameTimer = this.timeTrialDuration;
    this.clearPucks();

    // Create pucks
    for (let i = 0; i < PUCKS_PER_ROUND; i++) {
      this.pucks.push(this.createPuck(true, i));
      if (this.mode !== GM.TARGET && this.mode !== GM.TIME_TRIAL) {
        this.pucks.push(this.createPuck(false, i));
      }
    }

    this.changeState(GS.PLAYER_AIM);
    this.updateHUD();
  }

  private clearPucks() {
    for (const p of this.pucks) {
      this.w.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as MeshStandardMaterial).dispose();
    }
    this.pucks = [];
  }

  // ===== PLAYER TURN =====
  private preparePlayerPuck() {
    const playerPucks = this.pucks.filter(p => p.isPlayer && !p.active && p.settled && p.idx === this.playerPucksUsed);
    if (playerPucks.length === 0) return;

    this.turnPuck = playerPucks[0];
    this.turnPuck.x = 0;
    this.turnPuck.z = LAUNCH_Z;
    this.turnPuck.vx = 0;
    this.turnPuck.vz = 0;
    this.turnPuck.active = true;
    this.turnPuck.settled = true;
    this.turnPuck.mesh.visible = true;
    this.positionPuck(this.turnPuck);

    this.aimAngle = 0;
    this.power = 0;
    this.charging = false;
    this.aimGroup.position.set(0, TABLE_Y + 0.02, LAUNCH_Z);
    this.updateAimVisual();
  }

  private launchPuck() {
    if (!this.turnPuck || this.power < 0.05) return;

    const speed = this.power * MAX_POWER;
    const dir = this.aimAngle;
    this.turnPuck.vx = Math.sin(dir) * speed;
    this.turnPuck.vz = -Math.cos(dir) * speed;
    this.turnPuck.settled = false;
    this.playerPucksUsed++;
    this.playSfx('slide');

    this.turnPuck = null;
    this.changeState(GS.PLAYER_SLIDE);
  }

  // ===== AI TURN =====
  private planAIShot() {
    const variance = DIFF_VARIANCE[this.difficulty];
    const aimErr = DIFF_AIM_ERR[this.difficulty];

    // Target a high-scoring zone
    const targetZone = this.difficulty === 0 ? 1 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 2);
    const targetZ = ZONE_START - (targetZone - 0.5) * ZONE_LEN;
    this.aiTargetX = (Math.random() - 0.5) * aimErr;

    // Check if should aim to knock off player puck
    const playerOnTable = this.pucks.filter(p => p.isPlayer && p.active);
    if (playerOnTable.length > 0 && Math.random() < 0.3 + this.difficulty * 0.15) {
      const target = playerOnTable[Math.floor(Math.random() * playerOnTable.length)];
      this.aiTargetX = target.x + (Math.random() - 0.5) * aimErr;
    }

    // Calculate power needed to reach target zone
    const dist = Math.abs(targetZ - LAUNCH_Z);
    this.aiTargetPower = Math.min(1, (dist / TABLE_LEN) * 1.2 + (Math.random() - 0.5) * variance);
  }

  private executeAIShot() {
    const aiPucks = this.pucks.filter(p => !p.isPlayer && !p.active && p.settled && p.idx === this.aiPucksUsed);
    if (aiPucks.length === 0) return;

    const puck = aiPucks[0];
    puck.x = 0;
    puck.z = LAUNCH_Z;
    puck.active = true;
    puck.settled = false;
    puck.mesh.visible = true;

    const speed = this.aiTargetPower * MAX_POWER;
    const angle = Math.atan2(this.aiTargetX, 1) + (Math.random() - 0.5) * DIFF_AIM_ERR[this.difficulty];
    puck.vx = Math.sin(angle) * speed;
    puck.vz = -Math.cos(angle) * speed;

    this.aiPucksUsed++;
    this.positionPuck(puck);
    this.playSfx('slide');
    this.changeState(GS.AI_SLIDE);
  }

  // ===== PHYSICS =====
  private updatePuckPhysics(delta: number) {
    const activePucks = this.pucks.filter(p => p.active);

    for (const p of activePucks) {
      if (p.settled) continue;

      const speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
      if (speed < MIN_SPEED) {
        p.vx = 0;
        p.vz = 0;
        p.settled = true;
        continue;
      }

      // Friction deceleration
      const decel = FRICTION * delta;
      const newSpeed = Math.max(0, speed - decel);
      const ratio = newSpeed / speed;
      p.vx *= ratio;
      p.vz *= ratio;

      // Move
      p.x += p.vx * delta;
      p.z += p.vz * delta;

      // Side rail bounce
      if (p.x < -TABLE_HW + PUCK_R) {
        p.x = -TABLE_HW + PUCK_R;
        p.vx *= -BOUNCE_DAMP;
        this.playSfx('bump');
      }
      if (p.x > TABLE_HW - PUCK_R) {
        p.x = TABLE_HW - PUCK_R;
        p.vx *= -BOUNCE_DAMP;
        this.playSfx('bump');
      }

      // Off far end
      if (p.z < TABLE_END_Z - PUCK_R) {
        this.removePuckFromTable(p);
        this.playSfx('fall');
        continue;
      }

      // Back wall bounce
      if (p.z > TABLE_START_Z - PUCK_R) {
        p.z = TABLE_START_Z - PUCK_R;
        p.vz *= -BOUNCE_DAMP;
        this.playSfx('bump');
      }

      // Spawn trail particle
      if (speed > 0.5 && Math.random() < 0.3) {
        this.spawnTrailParticle(p.x, p.z, p.isPlayer);
      }

      this.positionPuck(p);
    }

    // Puck-puck collisions
    for (let i = 0; i < activePucks.length; i++) {
      for (let j = i + 1; j < activePucks.length; j++) {
        const a = activePucks[i];
        const b = activePucks[j];
        if (!a.active || !b.active) continue;

        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const minDist = PUCK_R * 2;

        if (dist < minDist && dist > 0.0001) {
          const nx = dx / dist;
          const nz = dz / dist;
          const dvx = a.vx - b.vx;
          const dvz = a.vz - b.vz;
          const dvn = dvx * nx + dvz * nz;

          if (dvn > 0) {
            a.vx -= dvn * nx * 0.9;
            a.vz -= dvn * nz * 0.9;
            b.vx += dvn * nx * 0.9;
            b.vz += dvn * nz * 0.9;

            const overlap = minDist - dist;
            a.x -= nx * overlap * 0.5;
            a.z -= nz * overlap * 0.5;
            b.x += nx * overlap * 0.5;
            b.z += nz * overlap * 0.5;

            a.settled = false;
            b.settled = false;

            this.playSfx('hit');
          }
        }
      }
    }
  }

  // ===== TRAIL PARTICLES =====
  private spawnTrailParticle(x: number, z: number, isPlayer: boolean) {
    const mesh = new Mesh(
      new SphereGeometry(0.005, 4, 4),
      new MeshBasicMaterial({
        color: isPlayer ? PLAYER_COLOR : AI_COLOR,
        transparent: true,
        opacity: 0.5,
      }),
    );
    mesh.position.set(x, TABLE_Y + 0.02, z);
    this.w.scene.add(mesh);
    this.trailParticles.push({ mesh, life: 0.8 });
  }

  private updateParticles(delta: number) {
    for (let i = this.trailParticles.length - 1; i >= 0; i--) {
      const p = this.trailParticles[i];
      p.life -= delta;
      if (p.life <= 0) {
        this.w.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as MeshBasicMaterial).dispose();
        this.trailParticles.splice(i, 1);
      } else {
        (p.mesh.material as MeshBasicMaterial).opacity = p.life * 0.5;
        p.mesh.scale.setScalar(p.life);
      }
    }

    // Score popups
    for (let i = this.scorePopups.length - 1; i >= 0; i--) {
      const sp = this.scorePopups[i];
      sp.life -= delta;
      sp.mesh.position.y += delta * 0.5;
      if (sp.life <= 0) {
        this.w.scene.remove(sp.mesh);
        sp.mesh.geometry.dispose();
        (sp.mesh.material as MeshBasicMaterial).dispose();
        this.scorePopups.splice(i, 1);
      } else {
        (sp.mesh.material as MeshBasicMaterial).opacity = sp.life;
      }
    }
  }

  // ===== SCORING =====
  private getZoneForPuck(p: Puck): number {
    if (!p.active) return 0;
    if (p.z > ZONE_START) return 0;
    const zoneIdx = Math.floor((ZONE_START - p.z) / ZONE_LEN);
    if (zoneIdx < 0 || zoneIdx >= 4) return 0;
    return ZONE_POINTS[zoneIdx];
  }

  private scoreRound() {
    this.playerRoundScore = 0;
    this.aiRoundScore = 0;

    let zone4Count = 0;
    let playerScoringPucks = 0;

    for (const p of this.pucks) {
      const pts = this.getZoneForPuck(p);
      if (p.isPlayer) {
        this.playerRoundScore += pts;
        if (pts > 0) playerScoringPucks++;
        if (pts === 4) zone4Count++;
      } else {
        this.aiRoundScore += pts;
        if (pts > 0) this.aiScoredThisGame = true;
      }
    }

    this.playerScore += this.playerRoundScore;
    this.aiScore += this.aiRoundScore;

    // Achievement checks
    if (this.playerRoundScore > 0) this.unlock(0);
    if (zone4Count > 0) { this.unlock(1); this.save.zone4Hits += zone4Count; }
    if (zone4Count >= 3) this.unlock(4);
    if (playerScoringPucks === PUCKS_PER_ROUND) this.unlock(2);
    if (this.playerRoundScore === PUCKS_PER_ROUND * 4) {
      this.unlock(10);
      this.save.perfectRounds++;
    }
    if (this.playerRoundScore > this.save.bestRound) this.save.bestRound = this.playerRoundScore;

    // Trailing check for comeback
    if (this.aiScore > this.playerScore + 8) {
      this.wasTrailing = true;
      this.trailAmount = this.aiScore - this.playerScore;
    }

    // Flash zone highlights
    for (const p of this.pucks) {
      if (p.active) {
        const pts = this.getZoneForPuck(p);
        if (pts > 0) {
          this.spawnScorePopup(p.x, p.z, pts, p.isPlayer);
        }
      }
    }

    this.updateHUD();
    this.playSfx('score');

    // Check if game continues
    if (this.mode === GM.SURVIVAL) {
      if (this.playerRoundScore < this.survivalMinScore) {
        setTimeout(() => this.changeState(GS.GAME_OVER), 2000);
        return;
      }
      this.survivalRound++;
      this.survivalMinScore = Math.min(12, 3 + this.survivalRound);
      if (this.survivalRound > this.save.survivalBest) this.save.survivalBest = this.survivalRound;
      if (this.survivalRound >= 10) this.unlock(17);

      setTimeout(() => {
        this.round++;
        this.playerPucksUsed = 0;
        this.aiPucksUsed = 0;
        this.clearPucks();
        for (let i = 0; i < PUCKS_PER_ROUND; i++) {
          this.pucks.push(this.createPuck(true, i));
          this.pucks.push(this.createPuck(false, i));
        }
        this.isPlayerTurn = true;
        this.changeState(GS.PLAYER_AIM);
      }, 2000);
      return;
    }

    if (this.round >= TOTAL_ROUNDS || (this.mode === GM.TARGET || this.mode === GM.TIME_TRIAL)) {
      setTimeout(() => this.changeState(GS.GAME_OVER), 2000);
    } else {
      setTimeout(() => {
        this.round++;
        this.playerPucksUsed = 0;
        this.aiPucksUsed = 0;
        this.isPlayerTurn = true;
        this.clearPucks();
        for (let i = 0; i < PUCKS_PER_ROUND; i++) {
          this.pucks.push(this.createPuck(true, i));
          if (this.mode === GM.CLASSIC) this.pucks.push(this.createPuck(false, i));
        }
        this.changeState(GS.PLAYER_AIM);
      }, 2000);
    }
  }

  private spawnScorePopup(x: number, z: number, points: number, isPlayer: boolean) {
    const mesh = new Mesh(
      new SphereGeometry(0.02, 8, 8),
      new MeshBasicMaterial({
        color: isPlayer ? 0x00ff88 : 0xff4466,
        transparent: true,
        opacity: 1,
      }),
    );
    mesh.position.set(x, TABLE_Y + 0.1, z);
    this.w.scene.add(mesh);
    this.scorePopups.push({ mesh, life: 1.5 });
  }

  // ===== END GAME =====
  private endGame() {
    this.showOnlyPanel('gameover');
    this.showAim(false);

    const won = this.playerScore > this.aiScore;
    this.save.gamesPlayed++;
    this.save.totalScore += this.playerScore;
    if (this.playerScore > this.save.bestScore) this.save.bestScore = this.playerScore;

    if (won || this.mode === GM.TARGET || this.mode === GM.TIME_TRIAL) {
      this.save.gamesWon++;
      this.save.streak++;
      if (this.save.streak > this.save.bestStreak) this.save.bestStreak = this.save.streak;
      this.unlock(5);
      if (this.playerScore - this.aiScore >= 15) this.unlock(6);
      if (this.wasTrailing) this.unlock(7);
      if (this.save.streak >= 3) this.unlock(8);
      if (this.save.streak >= 5) this.unlock(9);
      if (this.difficulty === 2) this.unlock(15);
      if (this.difficulty === 2 && !this.aiScoredThisGame) this.unlock(16);
    } else {
      this.save.streak = 0;
    }

    if (this.mode === GM.TIME_TRIAL && this.playerScore >= 25) this.unlock(18);
    if (this.save.totalScore >= 100) this.unlock(11);
    if (this.save.totalScore >= 500) this.unlock(12);
    if (this.save.gamesPlayed >= 10) this.unlock(13);
    if (this.save.gamesPlayed >= 25) this.unlock(14);

    this.updateGameOverUI(won);
    this.saveToDisk();
    this.playSfx(won ? 'win' : 'lose');
  }

  // ===== UPDATE =====
  update(delta: number, time: number) {
    const dt = Math.min(delta, 0.05);

    this.updatePuckPhysics(dt);
    this.updateParticles(dt);
    this.updateZoneGlow(time);

    switch (this.state) {
      case GS.PLAYER_AIM:
        this.handlePlayerInput(dt);
        break;
      case GS.PLAYER_SLIDE:
        if (this.allSettled()) {
          this.nextTurn();
        }
        break;
      case GS.AI_THINK:
        this.aiThinkTimer -= dt;
        if (this.aiThinkTimer <= 0) {
          this.executeAIShot();
        }
        break;
      case GS.AI_SLIDE:
        if (this.allSettled()) {
          this.nextTurn();
        }
        break;
      case GS.SETUP:
        break;
    }

    // Time trial countdown
    if ((this.state === GS.PLAYER_AIM || this.state === GS.PLAYER_SLIDE) && this.mode === GM.TIME_TRIAL) {
      this.gameTimer -= dt;
      this.updateHUDTimer();
      if (this.gameTimer <= 0) {
        this.changeState(GS.ROUND_SCORE);
      }
    }
  }

  private allSettled(): boolean {
    return this.pucks.filter(p => p.active && !p.settled).length === 0;
  }

  private nextTurn() {
    // Check if round is over
    const playerDone = this.playerPucksUsed >= PUCKS_PER_ROUND;
    const aiDone = this.mode === GM.TARGET || this.mode === GM.TIME_TRIAL || this.aiPucksUsed >= PUCKS_PER_ROUND;

    if (playerDone && aiDone) {
      this.changeState(GS.ROUND_SCORE);
      return;
    }

    if (this.mode === GM.TARGET || this.mode === GM.TIME_TRIAL) {
      if (!playerDone) {
        this.changeState(GS.PLAYER_AIM);
      } else {
        this.changeState(GS.ROUND_SCORE);
      }
      return;
    }

    // Alternate turns
    if (this.isPlayerTurn) {
      this.isPlayerTurn = false;
      if (!aiDone) {
        this.changeState(GS.AI_THINK);
      } else if (!playerDone) {
        this.isPlayerTurn = true;
        this.changeState(GS.PLAYER_AIM);
      } else {
        this.changeState(GS.ROUND_SCORE);
      }
    } else {
      this.isPlayerTurn = true;
      if (!playerDone) {
        this.changeState(GS.PLAYER_AIM);
      } else if (!aiDone) {
        this.isPlayerTurn = false;
        this.changeState(GS.AI_THINK);
      } else {
        this.changeState(GS.ROUND_SCORE);
      }
    }
  }

  // ===== INPUT =====
  private handlePlayerInput(dt: number) {
    const kb = this.w.input.keyboard;
    const right = this.w.input.xr.gamepads.right;

    // Aim angle
    let aimDelta = 0;
    if (kb.getKeyPressed('ArrowLeft') || kb.getKeyPressed('KeyA')) aimDelta += 1.2 * dt;
    if (kb.getKeyPressed('ArrowRight') || kb.getKeyPressed('KeyD')) aimDelta -= 1.2 * dt;

    // XR thumbstick
    if (right) {
      const stick = right.getAxesValues(InputComponent.Thumbstick);
      if (stick) aimDelta -= stick.x * 1.5 * dt;
    }

    this.aimAngle = Math.max(-0.5, Math.min(0.5, this.aimAngle + aimDelta));

    // Power charge
    const spaceDown = kb.getKeyDown('Space');
    const spaceHeld = kb.getKeyPressed('Space');
    const spaceUp = kb.getKeyUp('Space');

    const triggerDown = right?.getButtonDown(InputComponent.Trigger);
    const triggerHeld = right?.getButtonPressed(InputComponent.Trigger);
    const triggerUp = right?.getButtonUp(InputComponent.Trigger);

    if (spaceDown || triggerDown) {
      this.charging = true;
      this.power = 0;
    }
    if ((spaceHeld || triggerHeld) && this.charging) {
      this.power = Math.min(1, this.power + POWER_RATE * dt);
    }
    if ((spaceUp || triggerUp) && this.charging) {
      this.charging = false;
      this.launchPuck();
      return;
    }

    // Pause
    if (kb.getKeyDown('Escape')) {
      this.changeState(GS.PAUSE);
    }

    this.updateAimVisual();
  }

  // ===== ZONE GLOW =====
  private updateZoneGlow(time: number) {
    for (let i = 0; i < this.zoneMeshes.length; i++) {
      const m = this.zoneMeshes[i];
      const pulse = 0.12 + Math.sin(time * 2 + i * 0.5) * 0.04;
      (m.material as MeshStandardMaterial).opacity = pulse;
    }
  }

  // ===== AUDIO =====
  private initAudio() {
    try {
      this.audioCtx = new AudioContext();
    } catch { /* no audio */ }
  }

  private playSfx(type: string) {
    if (!this.audioCtx || this.save.sfxVol === 0) return;
    const vol = this.save.sfxVol / 100;
    const ctx = this.audioCtx;
    const t = ctx.currentTime;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      switch (type) {
        case 'slide':
          osc.type = 'sine';
          osc.frequency.setValueAtTime(200, t);
          osc.frequency.exponentialRampToValueAtTime(120, t + 0.3);
          gain.gain.setValueAtTime(0.15 * vol, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
          osc.start(t); osc.stop(t + 0.3);
          break;
        case 'hit':
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(600, t);
          osc.frequency.exponentialRampToValueAtTime(200, t + 0.15);
          gain.gain.setValueAtTime(0.25 * vol, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
          osc.start(t); osc.stop(t + 0.15);
          break;
        case 'bump':
          osc.type = 'square';
          osc.frequency.setValueAtTime(150, t);
          gain.gain.setValueAtTime(0.1 * vol, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
          osc.start(t); osc.stop(t + 0.08);
          break;
        case 'fall':
          osc.type = 'sine';
          osc.frequency.setValueAtTime(400, t);
          osc.frequency.exponentialRampToValueAtTime(80, t + 0.5);
          gain.gain.setValueAtTime(0.2 * vol, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
          osc.start(t); osc.stop(t + 0.5);
          break;
        case 'score':
          osc.type = 'sine';
          osc.frequency.setValueAtTime(440, t);
          osc.frequency.setValueAtTime(554, t + 0.1);
          osc.frequency.setValueAtTime(659, t + 0.2);
          gain.gain.setValueAtTime(0.2 * vol, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
          osc.start(t); osc.stop(t + 0.4);
          break;
        case 'win':
          osc.type = 'sine';
          osc.frequency.setValueAtTime(523, t);
          osc.frequency.setValueAtTime(659, t + 0.15);
          osc.frequency.setValueAtTime(784, t + 0.3);
          osc.frequency.setValueAtTime(1047, t + 0.45);
          gain.gain.setValueAtTime(0.2 * vol, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
          osc.start(t); osc.stop(t + 0.7);
          break;
        case 'lose':
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(300, t);
          osc.frequency.exponentialRampToValueAtTime(100, t + 0.6);
          gain.gain.setValueAtTime(0.12 * vol, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
          osc.start(t); osc.stop(t + 0.6);
          break;
      }
    } catch { /* ignore audio errors */ }
  }

  private startMusic() {
    if (!this.audioCtx || this.musicPlaying || this.save.musicVol === 0) return;
    try {
      const ctx = this.audioCtx;
      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = (this.save.musicVol / 100) * 0.08;
      this.musicGain.connect(ctx.destination);

      const playNote = (freq: number, start: number, dur: number) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        o.connect(g);
        g.connect(this.musicGain!);
        g.gain.setValueAtTime(0.08, start);
        g.gain.exponentialRampToValueAtTime(0.001, start + dur - 0.01);
        o.start(start);
        o.stop(start + dur);
      };

      const notes = [261, 293, 329, 349, 392, 440, 493, 523];
      const pattern = [0, 2, 4, 5, 4, 2, 3, 1, 0, 4, 3, 2, 5, 4, 3, 1];
      const t = ctx.currentTime;
      const beatLen = 0.5;

      for (let i = 0; i < pattern.length; i++) {
        playNote(notes[pattern[i]], t + i * beatLen, beatLen * 0.8);
      }

      this.musicPlaying = true;
      setTimeout(() => {
        this.musicPlaying = false;
        if (this.state !== GS.MENU && this.state !== GS.GAME_OVER) this.startMusic();
      }, pattern.length * beatLen * 1000);
    } catch { /* ignore */ }
  }

  // ===== UI UPDATES =====
  private updateMenuStats() {
    this.txt('menu', 'stats-line', `Games: ${this.save.gamesPlayed} | Won: ${this.save.gamesWon} | Best: ${this.save.bestScore}`);
  }

  private updateModeUI() {
    this.txt('mode', 'diff-label', DIFF_NAMES[this.difficulty]);
  }

  private updateSettingsUI() {
    this.txt('settings', 'sfx-val', `${this.save.sfxVol}%`);
    this.txt('settings', 'mus-val', `${this.save.musicVol}%`);
  }

  private updateHUD() {
    this.txt('hud', 'player-score', `${this.playerScore}`);
    this.txt('hud', 'ai-score', `${this.aiScore}`);
    this.txt('hud', 'round-label', `Round ${this.round}/${this.mode === GM.SURVIVAL ? '--' : TOTAL_ROUNDS}`);
    this.txt('hud', 'turn-label', this.isPlayerTurn ? 'YOUR TURN' : 'OPPONENT');
    this.txt('hud', 'pucks-left', `Pucks: ${PUCKS_PER_ROUND - this.playerPucksUsed}`);
    this.txt('hud', 'mode-label', MODE_NAMES[this.mode]);

    if (this.mode === GM.SURVIVAL) {
      this.txt('hud', 'round-label', `Survival Rd ${this.survivalRound} (min: ${this.survivalMinScore})`);
    }
  }

  private updateHUDTimer() {
    if (this.mode === GM.TIME_TRIAL) {
      this.txt('hud', 'turn-label', `Time: ${Math.ceil(this.gameTimer)}s`);
    }
  }

  private updateGameOverUI(won: boolean) {
    this.txt('gameover', 'result-label', this.mode === GM.TARGET || this.mode === GM.TIME_TRIAL ? 'GAME OVER' : (won ? 'YOU WIN!' : 'YOU LOSE'));
    this.txt('gameover', 'final-score', `Score: ${this.playerScore} - ${this.aiScore}`);

    let detail = '';
    if (this.mode === GM.SURVIVAL) detail = `Survived ${this.survivalRound} rounds`;
    else if (this.mode === GM.TIME_TRIAL) detail = `Scored ${this.playerScore} points`;
    else if (this.mode === GM.TARGET) detail = `Total: ${this.playerScore} points`;
    else detail = won ? 'Great game!' : 'Better luck next time!';
    this.txt('gameover', 'detail-line', detail);
  }

  private updateAchUI() {
    for (let i = 0; i < ACH.length; i++) {
      const unlocked = this.save.achievements[i];
      this.txt('ach', `ach-${i}`, `${unlocked ? '[*] ' : '[ ] '}${ACH[i]}`);
    }
    const count = this.save.achievements.filter(Boolean).length;
    this.txt('ach', 'ach-count', `${count}/${ACH.length} Unlocked`);
  }

  // ===== ACHIEVEMENTS =====
  private unlock(idx: number) {
    if (this.save.achievements[idx]) return;
    this.save.achievements[idx] = true;
    this.playSfx('score');
    this.saveToDisk();
  }

  // ===== DIFFICULTY =====
  private cycleDifficulty(dir: number) {
    this.difficulty = (this.difficulty + dir + 3) % 3;
    this.save.difficulty = this.difficulty;
    this.updateModeUI();
    this.saveToDisk();
  }

  // ===== VOLUME =====
  private adjustVol(type: string, delta: number) {
    if (type === 'sfx') {
      this.save.sfxVol = Math.max(0, Math.min(100, this.save.sfxVol + delta));
    } else {
      this.save.musicVol = Math.max(0, Math.min(100, this.save.musicVol + delta));
      if (this.musicGain) this.musicGain.gain.value = (this.save.musicVol / 100) * 0.08;
    }
    this.updateSettingsUI();
    this.saveToDisk();
  }

  // ===== SAVE/LOAD =====
  private loadSave() {
    try {
      const raw = localStorage.getItem('neon-shuffle-save');
      if (raw) {
        const data = JSON.parse(raw);
        this.save = { ...this.save, ...data };
        if (this.save.achievements.length < ACH.length) {
          while (this.save.achievements.length < ACH.length) this.save.achievements.push(false);
        }
      }
    } catch { /* fresh save */ }
  }

  private saveToDisk() {
    try {
      localStorage.setItem('neon-shuffle-save', JSON.stringify(this.save));
    } catch { /* ignore */ }
  }
}
