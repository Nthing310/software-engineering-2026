import express from "express";
import path from "path";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";

const app = express();
const httpServer = createServer(app);
const PORT = 3000;

app.use(express.json());

let mockPlans: any[] = [
  {
    id: "PLN-20231101-001",
    name: "A区管网日常巡检线路",
    status: "APPROVED",
    drone: "DJI M300",
    maxAlt: 50,
    author: "张伟",
    predefinedPath: [
      [118.78000, 32.05000], 
      [118.78500, 32.05500], 
      [118.79000, 32.05200], 
      [118.79800, 32.05800], 
      [118.80500, 32.05600],
    ],
    warnings: [],
    historyPath: []
  },
  {
    id: "PLN-20231102-005",
    name: "山区紧急测绘探测",
    status: "PENDING_APPROVAL",
    drone: "DJI Mavic 3E",
    maxAlt: 120,
    author: "王磊",
    predefinedPath: [
      [118.75000, 32.06000],
      [118.76000, 32.07000],
    ],
    warnings: [],
    historyPath: []
  },
  {
    id: "PLN-20231105-012",
    name: "农业植保作业(草稿)",
    status: "DRAFT",
    drone: "DJI Agras T40",
    maxAlt: 10,
    author: "李芳",
    predefinedPath: [],
    warnings: [],
    historyPath: []
  }
];

let activePlanId: string | null = null;
let simulationInterval: NodeJS.Timeout | null = null;

let currentDroneState = {
  lng: 0,
  lat: 0,
  alt: 0,
  speed: 0,
  battery: 100,
  signal: 100,
  flightMode: '巡航',
};

let targetWaypointIndex = 1;

const io = new Server(httpServer, {
  cors: { origin: "*" },
});

io.on("connection", (socket) => {
  console.log("Client connected to Drone WebSockets");
});

app.get("/api/plans", (req, res) => {
  res.json({ plans: mockPlans, activePlanId });
});

app.get("/api/plan/:id", (req, res) => {
  const plan = mockPlans.find(p => p.id === req.params.id);
  if (plan) res.json(plan);
  else res.status(404).json({ error: "Not found" });
});

app.post("/api/plan/:id/approve", (req, res) => {
  const plan = mockPlans.find(p => p.id === req.params.id);
  if (!plan) return res.status(404).json({ error: "Not found" });
  plan.status = "APPROVED";
  res.json({ success: true });
});

app.post("/api/plan/:id/reject", (req, res) => {
  const plan = mockPlans.find(p => p.id === req.params.id);
  if (!plan) return res.status(404).json({ error: "Not found" });
  plan.status = "REJECTED";
  res.json({ success: true });
});

app.post("/api/plan/:id/start", (req, res) => {
  if (simulationInterval) {
    return res.status(400).json({ error: "已有任务在飞行中，请先终止。当前飞行阶段：" + activePlanId });
  }

  const plan = mockPlans.find(p => p.id === req.params.id);
  if (!plan) return res.status(404).json({ error: "计划不存在" });
  if (plan.status !== "APPROVED" && plan.status !== "COMPLETED") return res.status(400).json({ error: "该计划未批准或状态错误" });

  activePlanId = plan.id;
  plan.status = "EXECUTING";
  plan.warnings = []; // clear old warnings
  plan.historyPath = [];

  const predefinedPath = plan.predefinedPath;

  currentDroneState = {
    lng: predefinedPath[0][0],
    lat: predefinedPath[0][1],
    alt: 50.0,
    speed: 12.5,
    battery: 100,
    signal: 100,
    flightMode: '巡航',
  };
  targetWaypointIndex = 1;
  plan.historyPath = [[currentDroneState.lng, currentDroneState.lat]];
  
  // Every 0.5 seconds generates 1 point
  simulationInterval = setInterval(() => {
    // Speed up simulation for faster demo, half the distance per tick since we run twice as fast
    const moveStep = currentDroneState.flightMode === '返航' ? 0.00075 : 0.0004 + (Math.random() * 0.0001); 
    
    // Anomaly Flags
    let warningPayload = null;

    let remainingStep = moveStep;
    while (remainingStep > 0) {
      const target = predefinedPath[targetWaypointIndex];
      // fallback in case of invalid state
      if (!target && currentDroneState.flightMode !== '返航') {
         currentDroneState.flightMode = '返航';
         targetWaypointIndex = 0;
         continue;
      }

      const dx = predefinedPath[targetWaypointIndex][0] - currentDroneState.lng;
      const dy = predefinedPath[targetWaypointIndex][1] - currentDroneState.lat;
      const distance = Math.sqrt(dx*dx + dy*dy);

      // Prevent infinite loop if waypoints are identical or too close
      if (distance < 0.000001) {
        currentDroneState.lng = predefinedPath[targetWaypointIndex][0];
        currentDroneState.lat = predefinedPath[targetWaypointIndex][1];
        if (currentDroneState.flightMode === '返航') {
           clearInterval(simulationInterval!);
           simulationInterval = null;
           activePlanId = null;
           plan.status = "COMPLETED";
           io.emit("system", { message: "无人机已安全返航并着陆。", planId: plan.id });
           io.emit("telemetry", { ...currentDroneState, flightMode: '已着陆', alt: 0, speed: 0, battery: currentDroneState.battery });
           return;
        }
        targetWaypointIndex++;
        if (targetWaypointIndex >= predefinedPath.length) {
           currentDroneState.flightMode = '返航';
           targetWaypointIndex = 0;
           warningPayload = { type: "INFO", desc: "巡检完毕，自动执行返航 (RTH)。", timestamp: new Date().toISOString() };
           plan.warnings.push(warningPayload);
        }
        continue; // skip subtracting distance, just move to next
      }

      if (distance <= remainingStep) {
        currentDroneState.lng = predefinedPath[targetWaypointIndex][0];
        currentDroneState.lat = predefinedPath[targetWaypointIndex][1];
        remainingStep -= distance;

        if (currentDroneState.flightMode === '返航') {
           clearInterval(simulationInterval!);
           simulationInterval = null;
           activePlanId = null;
           plan.status = "COMPLETED";
           io.emit("system", { message: "无人机已安全返航并着陆。", planId: plan.id });
           io.emit("telemetry", { ...currentDroneState, flightMode: '已着陆', alt: 0, speed: 0, battery: currentDroneState.battery });
           return;
        }
        targetWaypointIndex++;
        if (targetWaypointIndex >= predefinedPath.length) {
           currentDroneState.flightMode = '返航';
           targetWaypointIndex = 0;
           warningPayload = { type: "INFO", desc: "巡检完毕，自动执行返航 (RTH)。", timestamp: new Date().toISOString() };
           plan.warnings.push(warningPayload);
        }
      } else {
        // Simulate normal movement
        currentDroneState.lng += (dx / distance) * remainingStep;
        currentDroneState.lat += (dy / distance) * remainingStep;
        remainingStep = 0; // step consumed
        
        // Simulate slight yaw anomaly randomly
        if (currentDroneState.flightMode !== '返航' && Math.random() > 0.95) {
          currentDroneState.lng += 0.0005; // 50+ meters off path
          warningPayload = { type: "YAW", desc: "偏离预设轨迹超过50米！", timestamp: new Date().toISOString() };
          plan.warnings.push(warningPayload);
        }
      }
    }

    // Realistic state changes
    if (currentDroneState.flightMode !== '已着陆') {
      currentDroneState.alt = 50 + (Math.random() * 10 - 5); 
      currentDroneState.speed = currentDroneState.flightMode === '返航' ? 22 : 10 + (Math.random() * 4);
      currentDroneState.battery -= 0.5; // Drain faster for demo
      currentDroneState.signal = Math.random() > 0.95 ? 20 : 90 + Math.floor(Math.random() * 10);
    }

    if (currentDroneState.alt > 120) {
        warningPayload = { type: "OVER_ALTITUDE", desc: "超出安全飞行限高 120m！", timestamp: new Date().toISOString() };
        plan.warnings.push(warningPayload);
    }
    if (currentDroneState.battery <= 20 && currentDroneState.battery > 10) {
        warningPayload = { type: "LOW_BATTERY", desc: "电量低于20%，请注意返航。", timestamp: new Date().toISOString() };
        if (!plan.warnings.find((w:any) => w.type === 'LOW_BATTERY')) plan.warnings.push(warningPayload);
    }
    if (currentDroneState.battery <= 10 && currentDroneState.flightMode !== '返航') {
        warningPayload = { type: "CRITICAL_BATTERY", desc: "电量极低 (<=10%)，紧急返航！", timestamp: new Date().toISOString() };
        plan.warnings.push(warningPayload);
        currentDroneState.flightMode = '返航';
        targetWaypointIndex = 0;
    }
    if (currentDroneState.signal < 30) {
        warningPayload = { type: "LOST_SIGNAL", desc: "遥控图传信号微弱！", timestamp: new Date().toISOString() };
        plan.warnings.push(warningPayload);
    }

    plan.historyPath.push([currentDroneState.lng, currentDroneState.lat]);

    const dataPayload = { 
      ...currentDroneState, 
      timestamp: new Date().toISOString(),
      warning: warningPayload,
      historyPath: plan.historyPath,
      predefinedPath: plan.predefinedPath,
      planId: plan.id
    };

    io.emit("telemetry", dataPayload);

  }, 500);

  res.json({ success: true, message: "模拟飞行启动，数据监控推送中..." });
});

app.post("/api/plan/stop", (req, res) => {
  if (simulationInterval) {
    if (currentDroneState.flightMode === '返航') {
      return res.json({ success: false, error: "无人机已经在返航途中！" });
    }
    
    currentDroneState.flightMode = '返航';
    targetWaypointIndex = 0;
    
    const warningPayload = { type: "EMERGENCY_RTH", desc: "接收到人工紧急终止请求，执行强制返航。", timestamp: new Date().toISOString() };
    if (activePlanId) {
       const plan = mockPlans.find(p => p.id === activePlanId);
       if (plan) plan.warnings.push(warningPayload);
    }

    res.json({ success: true, message: "收到紧急返航指令 (EMERGENCY RTH)，无人机开始返航！" });
  } else {
    res.json({ success: false, error: "当前无活动任务" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Express and WebSocket Server running on http://localhost:${PORT}`);
  });
}

startServer();
