import { useState, useEffect, type ReactNode } from "react";
import { socket } from "./lib/socket";
import { Play, Square, AlertTriangle, Battery, Navigation, Activity, Map, CheckSquare, BarChart, Settings, Plus, RefreshCw, FileText, Upload } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
// @ts-ignore
import iconUrl from "leaflet/dist/images/marker-icon.png";
// @ts-ignore
import iconShadow from "leaflet/dist/images/marker-shadow.png";

// Setup default Leaflet icon
let DefaultIcon = L.icon({
  iconUrl: iconUrl,
  shadowUrl: iconShadow,
  iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// AMap definition helper so TS doesn't complain
declare global {
  interface Window { _AMapSecurityConfig: any; AMap: any; }
}

export default function App() {
  const [activeTab, setActiveTab] = useState("plans");
  const [monitoringPlanId, setMonitoringPlanId] = useState<string | null>(null);

  const startMonitoringPlan = (planId: string) => {
    setMonitoringPlanId(planId);
    setActiveTab("monitor");
  };

  return (
    <div className="flex h-screen w-full bg-[#0c0e12] text-slate-300 font-sans overflow-hidden">
      {/* Sidebar Navigation */}
      <nav className="w-64 bg-[#0c0e12] border-r border-slate-800 flex flex-col p-4 shrink-0 z-20">
        <h1 className="text-lg font-semibold tracking-tight text-white mb-8 flex items-center gap-2">
          <Navigation className="w-6 h-6 text-blue-600" />
          无人机飞行计划管理系统
        </h1>

        <div className="flex flex-col gap-2 flex-grow">
          <NavItem id="monitor" icon={<Activity className="w-4 h-4"/>} label="实时监控 (Monitor)" active={activeTab} set={setActiveTab} />
          <NavItem id="plans" icon={<Map className="w-4 h-4"/>} label="飞行计划 (Plans)" active={activeTab} set={setActiveTab} />
          <NavItem id="approvals" icon={<CheckSquare className="w-4 h-4"/>} label="审批管理 (Approvals)" active={activeTab} set={setActiveTab} />
          <NavItem id="analytics" icon={<BarChart className="w-4 h-4"/>} label="数据分析 (Analytics)" active={activeTab} set={setActiveTab} />
          <NavItem id="system" icon={<Settings className="w-4 h-4"/>} label="系统管理 (System)" active={activeTab} set={setActiveTab} />
        </div>

        <div className="mt-auto border-t border-slate-800 pt-4 text-xs text-slate-400 space-y-1">
          <p>当前用户：超级管理员</p>
          <p>系统状态：运行中</p>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden relative">
        {activeTab === "monitor" && <MonitorDashboard activePlanId={monitoringPlanId} />}
        {activeTab === "plans" && <FlightPlans onStartMonitor={startMonitoringPlan} />}
        {activeTab === "approvals" && <Approvals />}
        {activeTab === "analytics" && <Analytics />}
        {activeTab === "system" && <SystemSettings />}
      </main>
    </div>
  );
}

function NavItem({ id, icon, label, active, set }: { id: string, icon: ReactNode, label: string, active: string, set: (id: string) => void }) {
  return (
    <button 
      className={cn("text-left px-4 py-2 rounded transition-colors text-sm font-medium flex items-center gap-3", active === id ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white hover:bg-slate-800/50")}
      onClick={() => set(id)}
    >
      {icon} {label}
    </button>
  );
}

// ==========================================
// MONITORING DASHBOARD (Map & Telemetry)
// ==========================================
function MonitorDashboard({ activePlanId }: { activePlanId: string | null }) {
  const [telemetry, setTelemetry] = useState<any>(null);
  const [warnings, setWarnings] = useState<any[]>([]);
  const [isFlying, setIsFlying] = useState(false);
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(activePlanId);

  useEffect(() => {
    // Check if there is an active global plan first
    fetch("/api/plans").then(r => r.json()).then(data => {
      if (data.activePlanId) {
         setCurrentPlanId(data.activePlanId);
         setIsFlying(true);
      }
    });

    // Standard initialization for AMap inside React
    window._AMapSecurityConfig = { securityJsCode: "" }; 

    // WebSocket Listeners
    socket.on("telemetry", (data) => {
      if (currentPlanId && data.planId !== currentPlanId) return; // ignore telemetry for other plans
      
      setTelemetry(data);
      if (data.warning) {
        setWarnings(prev => [data.warning, ...prev].slice(0, 5)); // Keep last 5 warnings
      }
    });

    socket.on("system", (payload) => {
      if (currentPlanId && payload.planId !== currentPlanId) return;
      setIsFlying(false);
      setWarnings(prev => [{ type: "系统通知", desc: payload.message }, ...prev].slice(0, 5));
    });

    return () => {
      socket.off("telemetry");
      socket.off("system");
    };
  }, [currentPlanId]);

  const startFlight = async () => {
    if (!currentPlanId) {
      alert("请先在「飞行计划」中选择并启动一个任务！");
      return;
    }
    try {
      const res = await fetch(`/api/plan/${currentPlanId}/start`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setIsFlying(true);
        setWarnings([]);
      } else {
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const stopFlight = async () => {
    try {
      const res = await fetch("/api/plan/stop", { method: "POST" });
      const data = await res.json();
      if (data.success) {
         setWarnings(prev => [{ type: "系统通知", desc: data.message }, ...prev].slice(0, 5));
      } else {
         alert(data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="w-full h-full relative">
      {/* Map Background Layer */}
      <MapLayer telemetry={telemetry} isFlying={isFlying} />

      {/* Telemetry Dashboard (Top Right) */}
      <div className="absolute top-6 right-6 w-80 bg-[#161b22] border border-slate-700 rounded-xl shadow-2xl overflow-hidden p-0 text-slate-100 flex flex-col z-10 transition-all">
        <div className="px-4 py-3 border-b border-slate-800 flex justify-between items-center bg-[#1c2128]">
          <div className="flex flex-col">
            <h2 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Telemetry Console</h2>
            {currentPlanId ? (
              <span className="text-xs font-mono text-sky-400 mt-0.5">{currentPlanId}</span>
            ) : (
              <span className="text-[10px] text-orange-400 mt-0.5">未绑定任务</span>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
             <span className={cn("text-xs font-bold", telemetry?.flightMode === '返航' ? "text-red-500 animate-pulse" : (isFlying ? "text-green-500" : "text-slate-500"))}>
               {telemetry?.flightMode || '离线'}
             </span>
             <div className={cn("w-2 h-2 rounded-full", (isFlying && telemetry?.flightMode !== '返航') ? "bg-green-500 animate-pulse" : (telemetry?.flightMode === '返航' ? "bg-red-500 animate-pulse" : "bg-slate-500"))}></div>
          </div>
        </div>

        <div className="p-4 grid grid-cols-2 gap-4">
          <StatBox icon={<Navigation className="w-3 h-3 text-slate-500" />} label="Altitude" value={telemetry?.alt?.toFixed(1) || "0.0"} unit="m" />
          <StatBox icon={<Activity className="w-3 h-3 text-slate-500" />} label="Airspeed" value={telemetry?.speed?.toFixed(1) || "0.0"} unit="m/s" />
          <div className="col-span-2">
            <div className="flex justify-between text-[10px] text-slate-500 uppercase mb-1">
              <span className="flex items-center gap-1"><Battery className="w-3 h-3 text-slate-500"/>Battery Status</span>
              <span className="text-orange-400">{(telemetry?.battery || 100).toFixed(0)}%</span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div 
                className={cn("h-full transition-all bg-orange-500", (telemetry?.battery || 100) < 20 ? "bg-red-500" : "bg-orange-500")}
                style={{ width: `${Math.max(0, telemetry?.battery || 100)}%` }}
              ></div>
            </div>
          </div>
          <div className="col-span-2 text-xs text-slate-400 font-mono tracking-wider pt-2 border-t border-slate-800 flex justify-between">
            <span>LNG: <span className="text-white">{telemetry?.lng.toFixed(6) || "---.------"}</span></span>
            <span>LAT: <span className="text-white">{telemetry?.lat.toFixed(6) || "--.------"}</span></span>
          </div>
        </div>
      </div>

      {/* Controls (Bottom Center) */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex gap-4 z-10 bg-[#161b22] border border-slate-800 p-2 rounded-lg shadow-2xl">
        {!isFlying ? (
          <button onClick={startFlight} className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded text-sm hover:bg-blue-700 transition-colors font-medium">
            <Play className="w-4 h-4" fill="currentColor" /> START MISSION
          </button>
        ) : (telemetry?.flightMode !== '返航' ? (
          <button onClick={stopFlight} className="flex items-center gap-2 bg-red-600 text-white px-6 py-2 rounded text-sm hover:bg-red-700 transition-colors shadow-lg shadow-red-900/20 font-bold">
            <Square className="w-4 h-4" fill="currentColor" /> EMERGENCY RTH
          </button>
        ) : (
          <button disabled className="flex items-center gap-2 bg-orange-600/50 text-white/80 px-6 py-2 rounded text-sm cursor-not-allowed shadow-lg font-bold">
             无人机正在返航... 
          </button>
        ))}
      </div>

      {/* Warnings Panel (Bottom Left) */}
      <div className="absolute top-6 left-6 w-80 space-y-3 z-10 pointer-events-none">
        {warnings.map((w, i) => (
          <div key={i} className="animate-in slide-in-from-left w-full bg-red-950/90 border border-red-500 p-3 rounded-lg flex items-start gap-3 shadow-2xl pointer-events-auto">
            <div className="w-10 h-10 bg-red-600 rounded flex items-center justify-center shrink-0">
              <AlertTriangle className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="text-xs font-bold text-white uppercase">ALARM: {w.type}</div>
              <div className="text-[10px] text-red-200 mt-1">{w.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatBox({ icon, label, value, unit }: { icon: ReactNode, label: string, value: string, unit?: string }) {
  return (
    <div className="bg-[#1c2128] rounded p-2">
      <div className="text-[10px] text-slate-500 uppercase flex gap-1.5 items-center mb-1">
        {icon} {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-mono text-white">{value}</span>
        {unit && <span className="text-xs text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}


// ==========================================
// MAP COMPONENT (React-Leaflet)
// ==========================================

// A component that follows the drone automatically
function MapFollower({ isFlying, position }: { isFlying: boolean, position: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (isFlying && position) {
      map.panTo(position, { animate: true, duration: 0.5, easeLinearity: 1 });
    }
  }, [isFlying, position, map]);
  return null;
}

function MapLayer({ telemetry, isFlying }: { telemetry: any, isFlying: boolean }) {
  const defaultCenter: [number, number] = [32.0500, 118.7800]; // Nanjing
  
  // Notice Leaflet uses [lat, lng] array structure, backend is providing [lng, lat].
  // Need mapping:
  const presetPathLatLons = telemetry?.predefinedPath 
    ? telemetry.predefinedPath.map((p: any) => [p[1], p[0]] as [number, number])
    : [];

  const realPathLatLons = telemetry?.historyPath 
    ? telemetry.historyPath.map((p: any) => [p[1], p[0]] as [number, number])
    : [];

  const currentLatLon = telemetry ? [telemetry.lat, telemetry.lng] as [number, number] : defaultCenter;

  return (
    <div className="flex-1 relative bg-[#010409] flex flex-col w-full h-full p-6">
       <div className="absolute bottom-6 left-6 z-10 space-y-2 pointer-events-none">
          <div className="bg-[#1c2128]/90 backdrop-blur-sm border border-slate-700 p-3 rounded-lg text-xs space-y-2 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-4 h-1 bg-blue-500 rounded-full"></div> <span className="text-slate-300 font-medium">预设巡检路线 (Preset Path)</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-1 bg-red-500 rounded-full"></div> <span className="text-slate-300 font-medium">真实飞行轨迹 (Real Path)</span>
            </div>
          </div>
       </div>

      <div className="flex-1 border border-slate-800 bg-[#0d1117]/80 rounded-lg relative overflow-hidden flex items-center justify-center isolate">
        <MapContainer 
          center={defaultCenter} 
          zoom={14} 
          style={{ height: '100%', width: '100%', zIndex: 0 }}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          {presetPathLatLons.length > 0 && (
            <Polyline positions={presetPathLatLons} color="#3b82f6" weight={3} dashArray="10 5" />
          )}
          {realPathLatLons.length > 0 && (
            <Polyline positions={realPathLatLons} color="#ef4444" weight={4} />
          )}
          {isFlying && telemetry && (
            <Marker position={currentLatLon}>
              <Popup className="text-slate-800 font-mono text-xs">
                <strong>DR-99 ({telemetry.flightMode})</strong><br/>
                ALT: {telemetry.alt.toFixed(1)}m<br/>
                SPD: {telemetry.speed.toFixed(1)}m/s<br/>
                BAT: {telemetry.battery.toFixed(1)}%
              </Popup>
            </Marker>
          )}

          <MapFollower isFlying={isFlying} position={isFlying ? currentLatLon : null} />
        </MapContainer>
      </div>
    </div>
  )
}


// ==========================================
// FLIGHT PLANS (4.1 飞行计划管理)
// ==========================================
function FlightPlans({ onStartMonitor }: { onStartMonitor: (planId: string) => void }) {
  const [plans, setPlans] = useState<any[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<any>(null);

  useEffect(() => {
    fetch("/api/plans").then(r => r.json()).then(data => {
      setPlans(data.plans || []);
    });
  }, []);
  
  const handleStart = async (plan: any) => {
    onStartMonitor(plan.id);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'EXECUTING': return <span className="bg-blue-500/10 text-blue-400 px-2.5 py-0.5 rounded text-xs font-medium border border-blue-500/20 animate-pulse">执行中</span>;
      case 'APPROVED': return <span className="bg-green-500/10 text-green-400 px-2.5 py-0.5 rounded text-xs font-medium border border-green-500/20">已批准</span>;
      case 'PENDING_APPROVAL': return <span className="bg-yellow-500/10 text-yellow-500 px-2.5 py-0.5 rounded text-xs font-medium border border-yellow-500/20">待审批</span>;
      case 'REJECTED': return <span className="bg-red-500/10 text-red-500 px-2.5 py-0.5 rounded text-xs font-medium border border-red-500/20">已驳回</span>;
      case 'COMPLETED': return <span className="bg-slate-500/10 text-slate-400 px-2.5 py-0.5 rounded text-xs font-medium border border-slate-500/20">已归档</span>;
      default: return <span className="bg-slate-500/10 text-slate-400 px-2.5 py-0.5 rounded text-xs font-medium border border-slate-500/20">草稿</span>;
    }
  }

  return (
    <div className="p-8 h-full bg-[#0c0e12] text-slate-300 flex flex-col relative">
      <div className="flex justify-between items-end mb-8 border-b border-slate-800 pb-4 shrink-0">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white mb-2">飞行计划管理</h2>
          <p className="text-xs text-slate-500">创建、编辑、查询与提交飞行计划，全生命周期管控。</p>
        </div>
        <div className="flex gap-4">
          <button className="flex items-center gap-2 bg-[#1c2128] border border-slate-700 text-slate-300 px-4 py-2 rounded text-sm font-medium hover:bg-slate-800 transition-colors" onClick={() => fetch("/api/plans").then(r => r.json()).then(data => setPlans(data.plans || []))}>
            <RefreshCw className="w-4 h-4" /> 刷新
          </button>
          <button className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 transition-colors">
            <Plus className="w-4 h-4" /> 创建新计划
          </button>
        </div>
      </div>

      <div className="flex gap-4 mb-4 shrink-0">
        <input type="text" placeholder="搜索计划名称/编号" className="bg-[#1c2128] border border-slate-800 rounded px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500 w-64" />
        <select className="bg-[#1c2128] border border-slate-800 rounded px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
          <option>全部状态</option>
          <option>草稿</option>
          <option>待审批</option>
          <option>已批准</option>
          <option>执行中</option>
          <option>已归档</option>
        </select>
        <button className="bg-slate-800 text-white px-4 py-2 rounded text-sm font-medium hover:bg-slate-700 transition-colors">查询</button>
      </div>

      <div className="flex-1 overflow-auto bg-[#161b22] border border-slate-800 rounded-lg shadow-sm text-sm">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-[#1c2128] border-b border-slate-800 sticky top-0">
            <tr>
               <th className="px-6 py-3 font-medium text-slate-400">计划编号</th>
               <th className="px-6 py-3 font-medium text-slate-400">计划名称</th>
               <th className="px-6 py-3 font-medium text-slate-400">状态</th>
               <th className="px-6 py-3 font-medium text-slate-400">设备与高度</th>
               <th className="px-6 py-3 font-medium text-slate-400">创建人</th>
               <th className="px-6 py-3 font-medium text-slate-400">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50 text-slate-300">
            {plans.map((plan, i) => (
              <tr key={i} className="hover:bg-white/5 transition-colors">
                <td className="px-6 py-4 font-mono text-[12px] text-slate-400">{plan.id}</td>
                <td className="px-6 py-4 font-medium text-slate-200">{plan.name}</td>
                <td className="px-6 py-4">{getStatusBadge(plan.status)}</td>
                <td className="px-6 py-4 text-slate-400">{plan.drone} / <span className="font-mono text-white">{plan.maxAlt}m</span></td>
                <td className="px-6 py-4">{plan.author}</td>
                <td className="px-6 py-4 flex gap-3 text-blue-400 items-center">
                  {(plan.status === 'APPROVED' || plan.status === 'EXECUTING') ? (
                    <span className="cursor-pointer font-bold hover:text-blue-300" onClick={() => handleStart(plan)}>去监控面板</span>
                  ) : plan.status === 'COMPLETED' ? (
                     <span className="cursor-pointer text-green-400 font-bold hover:text-green-300" onClick={() => setSelectedPlan(plan)}>查看飞行报告与预警记录</span>
                  ) : (
                    <span className="cursor-pointer text-slate-500 hover:text-slate-300" onClick={() => setSelectedPlan(plan)}>查看详细</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedPlan && (
        <div className="absolute inset-0 bg-[#000000a0] z-50 flex items-center justify-center p-8 backdrop-blur-sm">
          <div className="bg-[#0c0e12] border border-slate-700 w-full max-w-4xl max-h-[90vh] rounded-xl flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden">
             <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-[#161b22]">
                <h3 className="text-lg font-bold text-white flex items-center gap-2"><Map className="w-5 h-5" /> {selectedPlan.status === 'COMPLETED' ? '飞行任务归档报告' : '飞行计划详情'}</h3>
                <button className="text-slate-500 hover:text-white" onClick={() => setSelectedPlan(null)}>
                  <Square className="w-5 h-5 rotate-45 scale-125" /> {/* simple X icon mock */}
                </button>
             </div>
             
             <div className="p-6 overflow-y-auto flex-1">
                <div className="grid grid-cols-3 gap-4 mb-8">
                   <div className="bg-[#1c2128] p-4 rounded border border-slate-800">
                      <div className="text-xs text-slate-500 mb-1">任务编号</div>
                      <div className="font-mono font-bold text-white">{selectedPlan.id}</div>
                   </div>
                   <div className="bg-[#1c2128] p-4 rounded border border-slate-800">
                      <div className="text-xs text-slate-500 mb-1">设备类型</div>
                      <div className="font-mono font-bold text-white">{selectedPlan.drone}</div>
                   </div>
                   <div className="bg-[#1c2128] p-4 rounded border border-slate-800">
                      <div className="text-xs text-slate-500 mb-1">状态</div>
                      <div className="font-mono font-bold text-white mb-2">{getStatusBadge(selectedPlan.status)}</div>
                   </div>
                </div>

                {selectedPlan.status === 'COMPLETED' ? (
                  <>
                    <h4 className="font-bold text-white mb-4 border-b border-slate-800 pb-2">飞行异常预警纪实表 (Warning Logs)</h4>
                    
                    {selectedPlan.warnings?.length > 0 ? (
                      <table className="w-full text-left text-sm">
                        <thead className="bg-[#161b22]">
                          <tr>
                            <th className="px-4 py-2 font-medium text-slate-400">时间 (Timestamp)</th>
                            <th className="px-4 py-2 font-medium text-slate-400">预警类型</th>
                            <th className="px-4 py-2 font-medium text-slate-400">详细描述</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {selectedPlan.warnings.map((w: any, idx: number) => (
                            <tr key={idx} className="hover:bg-[#161b22]">
                              <td className="px-4 py-3 font-mono text-[12px] text-slate-400">
                                 {new Date(w.timestamp).toLocaleTimeString()}
                              </td>
                              <td className="px-4 py-3">
                                 <span className={cn("px-2 py-0.5 rounded text-[11px] font-bold", w.type === 'INFO' ? "bg-blue-500/20 text-blue-400" : "bg-red-500/20 border border-red-500/30 text-red-400")}>
                                   {w.type}
                                 </span>
                              </td>
                              <td className="px-4 py-3 text-slate-300">{w.desc}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="text-center py-8 text-slate-500">
                         本次飞行未触发任何异常预警记录，飞行状态极其良好。
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-slate-400">
                    <h4 className="font-bold text-white mb-4 border-b border-slate-800 pb-2">计划详细信息</h4>
                    <p className="mb-2"><strong>计划名称：</strong>{selectedPlan.name}</p>
                    <p className="mb-2"><strong>创建人：</strong>{selectedPlan.author}</p>
                    <p className="mb-2"><strong>最高飞行高度：</strong>{selectedPlan.maxAlt}m</p>
                    <p className="mb-2"><strong>预设航点数量：</strong>{selectedPlan.predefinedPath?.length || 0}</p>
                  </div>
                )}
             </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ==========================================
// APPROVALS (4.2 审批管理)
// ==========================================
function Approvals() {
  const [plans, setPlans] = useState<any[]>([]);

  const fetchPlans = () => {
    fetch("/api/plans").then(r => r.json()).then(data => {
      setPlans(data.plans?.filter((p: any) => p.status === 'PENDING_APPROVAL') || []);
    });
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  const handleApprove = async (id: string) => {
      await fetch(`/api/plan/${id}/approve`, { method: "POST" });
      fetchPlans();
  };

  const handleReject = async (id: string) => {
      await fetch(`/api/plan/${id}/reject`, { method: "POST" });
      fetchPlans();
  };

  return (
    <div className="p-8 h-full bg-[#0c0e12] text-slate-300">
      <div className="flex justify-between items-end mb-8 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white mb-2">审批管理</h2>
          <p className="text-xs text-slate-500">线上审核与审批流程流转，支持多级审批模式。</p>
        </div>
        <div className="flex bg-[#1c2128] rounded p-1">
          <button className="px-4 py-1.5 bg-slate-800 text-white rounded shadow text-sm">待办审批 ({plans.length})</button>
        </div>
      </div>

      <div className="bg-[#161b22] border border-slate-800 rounded-lg shadow-sm overflow-hidden text-sm">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-[#1c2128] border-b border-slate-800">
            <tr>
               <th className="px-6 py-3 font-medium text-slate-400">任务编号</th>
               <th className="px-6 py-3 font-medium text-slate-400">申请事项</th>
               <th className="px-6 py-3 font-medium text-slate-400">申请人</th>
               <th className="px-6 py-3 font-medium text-slate-400">设备 / 限高</th>
               <th className="px-6 py-3 font-medium text-slate-400">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50 text-slate-300">
            {plans.length === 0 && (
              <tr>
                 <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                    当前暂无待审批的飞行计划。
                 </td>
              </tr>
            )}
            {plans.map((p, i) => (
              <tr key={i} className="hover:bg-white/5 transition-colors bg-blue-900/10">
                <td className="px-6 py-4 font-mono text-[12px] text-slate-400">{p.id}</td>
                <td className="px-6 py-4 font-medium text-slate-200">{p.name}</td>
                <td className="px-6 py-4">{p.author}</td>
                <td className="px-6 py-4 text-slate-400">{p.drone} / <span className="font-mono text-white">{p.maxAlt}m</span></td>
                <td className="px-6 py-4 flex gap-3 text-sm">
                  <span className="text-green-500 cursor-pointer hover:text-green-400 font-bold" onClick={() => handleApprove(p.id)}>批准</span>
                  <span className="text-red-500 cursor-pointer hover:text-red-400" onClick={() => handleReject(p.id)}>驳回</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ==========================================
// ANALYTICS (4.4 数据分析)
// ==========================================
function Analytics() {
  return (
    <div className="p-8 h-full bg-[#0c0e12] text-slate-300 overflow-y-auto">
      <div className="flex justify-between items-end mb-8 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white mb-2">数据分析</h2>
          <p className="text-xs text-slate-500">统计多维度核心指标，支持图表可视化与报表导出。</p>
        </div>
        <button className="flex items-center gap-2 bg-[#1c2128] border border-slate-700 text-slate-300 px-4 py-2 rounded text-sm font-medium hover:bg-slate-800 transition-colors">
          <Upload className="w-4 h-4" /> 导出报表
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-[#161b22] border border-slate-800 p-4 rounded-lg flex flex-col justify-between">
          <div className="text-slate-400 text-xs mb-2">本月飞行次数</div>
          <div className="text-3xl font-mono text-white">412</div>
          <div className="text-xs text-green-400 mt-2">↑ 12% 较上月</div>
        </div>
        <div className="bg-[#161b22] border border-slate-800 p-4 rounded-lg flex flex-col justify-between">
          <div className="text-slate-400 text-xs mb-2">飞行成功率</div>
          <div className="text-3xl font-mono text-white">98.5%</div>
          <div className="text-xs text-green-400 mt-2">正常完成</div>
        </div>
        <div className="bg-[#161b22] border border-slate-800 p-4 rounded-lg flex flex-col justify-between">
          <div className="text-slate-400 text-xs mb-2">历史累计里程 (km)</div>
          <div className="text-3xl font-mono text-white">3,248</div>
        </div>
        <div className="bg-[#161b22] border border-slate-800 p-4 rounded-lg flex flex-col justify-between">
          <div className="text-slate-400 text-xs mb-2">审批及时率 (24h)</div>
          <div className="text-3xl font-mono text-white">94%</div>
          <div className="text-xs text-red-400 mt-2">↓ 2% 存在延迟</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 h-64">
        <div className="bg-[#161b22] border border-slate-800 rounded-lg p-4 flex flex-col items-center justify-center text-slate-500">
          <BarChart className="w-12 h-12 mb-2 opacity-50" />
          <p className="text-sm">任务类型分布统计图区域</p>
        </div>
        <div className="bg-[#161b22] border border-slate-800 rounded-lg p-4 flex flex-col items-center justify-center text-slate-500">
          <Activity className="w-12 h-12 mb-2 opacity-50" />
          <p className="text-sm">近期异常预警趋势图区域</p>
        </div>
      </div>
    </div>
  )
}

// ==========================================
// SYSTEM SETTINGS (4.5 系统管理)
// ==========================================
function SystemSettings() {
  return (
    <div className="p-8 h-full bg-[#0c0e12] text-slate-300">
      <div className="flex justify-between items-end mb-8 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white mb-2">系统管理</h2>
          <p className="text-xs text-slate-500">基础配置、用户管理、日志查询与数据备份核心入口。</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="bg-[#161b22] border border-slate-800 p-5 rounded-lg hover:border-slate-600 transition-colors cursor-pointer">
          <div className="bg-blue-500/10 w-10 h-10 rounded flex items-center justify-center mb-4">
            <CheckSquare className="w-5 h-5 text-blue-400" />
          </div>
          <h3 className="font-bold text-white mb-1">用户与角色</h3>
          <p className="text-xs text-slate-400 leading-relaxed">管理操作员、审批人员与管理员账户，控制核心权限与修改默认密码。</p>
        </div>

        <div className="bg-[#161b22] border border-slate-800 p-5 rounded-lg hover:border-slate-600 transition-colors cursor-pointer">
          <div className="bg-amber-500/10 w-10 h-10 rounded flex items-center justify-center mb-4">
            <Map className="w-5 h-5 text-amber-400" />
          </div>
          <h3 className="font-bold text-white mb-1">空域与设备配置</h3>
          <p className="text-xs text-slate-400 leading-relaxed">编辑禁飞区、适飞区地图数据。录入与更新系统适配的无人机型号字典。</p>
        </div>

        <div className="bg-[#161b22] border border-slate-800 p-5 rounded-lg hover:border-slate-600 transition-colors cursor-pointer">
          <div className="bg-emerald-500/10 w-10 h-10 rounded flex items-center justify-center mb-4">
            <FileText className="w-5 h-5 text-emerald-400" />
          </div>
          <h3 className="font-bold text-white mb-1">审计交互日志</h3>
          <p className="text-xs text-slate-400 leading-relaxed">操作可追溯：随时查询登录日志、系统日志和用户所有改动审计痕迹。</p>
        </div>

        <div className="bg-[#161b22] border border-slate-800 p-5 rounded-lg hover:border-slate-600 transition-colors cursor-pointer">
          <div className="bg-purple-500/10 w-10 h-10 rounded flex items-center justify-center mb-4">
            <RefreshCw className="w-5 h-5 text-purple-400" />
          </div>
          <h3 className="font-bold text-white mb-1">数据备份与恢复</h3>
          <p className="text-xs text-slate-400 leading-relaxed">设置定时备份策略，手动全量存档SQL，或选择可用备份进行回滚。</p>
        </div>
      </div>
    </div>
  )
}
