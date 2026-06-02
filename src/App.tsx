import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import { 
  Bell, 
  Clock, 
  Calendar, 
  CheckCircle2, 
  AlertCircle, 
  Plus, 
  ArrowRight, 
  Activity,
  User,
  LayoutDashboard,
  Heart,
  FileText,
  Phone,
  Power,
  ShieldAlert,
  ChevronRight,
  Wifi,
  Share2,
  LogOut,
  LogIn,
  Cpu,
  Copy,
  RefreshCw,
  Trash2
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { jsPDF } from 'jspdf';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area 
} from 'recharts';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  doc, 
  deleteDoc, 
  updateDoc, 
  orderBy,
  limit,
  serverTimestamp
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth, db, signInWithGoogle, handleFirestoreError, OperationType } from './lib/firebase';
import { useAuth } from './components/FirebaseProvider';

// Types
interface Patient {
  id: string;
  name: string;
  age: number;
  gender: string;
}

interface ScheduleItem {
  id: string;
  patientId: string;
  time: string;
  label: string;
  pills: string[];
  status: "pending" | "taken" | "missed";
  mealTiming: "before" | "after" | "none";
}

interface VitalEntry {
  id: string;
  patientId: string;
  timestamp: string;
  type: "blood_pressure" | "blood_sugar" | "heart_rate" | "weight";
  value: number;
  value2?: number; 
  unit: string;
}

interface Contact {
  id: string;
  patientId: string;
  name: string;
  relation: string;
  phone: string;
  type: "doctor" | "family" | "emergency";
}

interface ChatMessage {
  role: "user" | "model";
  parts: { text: string }[];
}

interface LogEntry {
  id: string;
  patientId?: string;
  timestamp: string;
  event: string;
  type: "info" | "warning" | "alert" | "success";
}

interface Status {
  online: boolean;
  patient_name: string;
  patient_id: string;
  last_sync: string;
  next_medication: ScheduleItem | null;
}

// Helper for vital status
export const getVitalStatus = (type: string, v1: number, v2?: number) => {
  switch (type) {
    case 'blood_pressure':
      if (v1 >= 180 || (v2 && v2 >= 120)) return { label: 'Hypertensive Crisis', color: 'text-red-500', severity: 'alert' };
      if (v1 >= 140 || (v2 && v2 >= 90)) return { label: 'High Blood Pressure', color: 'text-amber-500', severity: 'warning' };
      if (v1 < 90 || (v2 && v2 < 60)) return { label: 'Low Blood Pressure', color: 'text-amber-500', severity: 'warning' };
      return { label: 'Optimal Range', color: 'text-green-500', severity: 'success' };
    
    case 'blood_sugar':
      if (v1 >= 250 || v1 < 50) return { label: 'Danger Level', color: 'text-red-500', severity: 'alert' };
      if (v1 >= 140) return { label: 'High Sugar Level', color: 'text-amber-500', severity: 'warning' };
      if (v1 < 70) return { label: 'Low Sugar Level', color: 'text-amber-500', severity: 'warning' };
      return { label: 'Normal Range', color: 'text-green-500', severity: 'success' };

    case 'heart_rate':
      if (v1 >= 120 || v1 <= 40) return { label: 'Irregular Rhythm', color: 'text-red-500', severity: 'alert' };
      if (v1 > 100) return { label: 'Tachycardia (High)', color: 'text-amber-500', severity: 'warning' };
      if (v1 < 60) return { label: 'Bradycardia (Low)', color: 'text-amber-500', severity: 'warning' };
      return { label: 'Healthy Rhythm', color: 'text-green-500', severity: 'success' };

    default:
      return { label: 'Stable', color: 'text-slate-400', severity: 'info' };
  }
};

export default function App() {
  const { user, loading, isAdmin, profile } = useAuth();
  const [socket, setSocket] = useState<any>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const [status, setStatus] = useState<Status | null>(null);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isAlerting, setIsAlerting] = useState(false);
  const [latestAlert, setLatestAlert] = useState<LogEntry | null>(null);

  // New Page States
  const [currentView, setCurrentView] = useState<'dashboard' | 'vitals' | 'contacts' | 'reports'>('dashboard');
  const [vitalsData, setVitalsData] = useState<VitalEntry[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isPatientModalOpen, setIsPatientModalOpen] = useState(false);
  const [isHardwareModalOpen, setIsHardwareModalOpen] = useState(false);

  // AI Advisor States
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  // New Entry States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newEntry, setNewEntry] = useState({
    time: "08:00",
    label: "",
    pills: "",
    mealTiming: "none" as "before" | "after" | "none"
  });

  // Medication Refill States
  const [isRefillModalOpen, setIsRefillModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refillData, setRefillData] = useState({
    selectedMeds: [] as string[],
    daysOfSupply: "30",
    customMedsText: "",
    isAddingNewMed: false,
    newMedTime: "08:00",
    newMedLabel: "",
    newMedPills: "",
    newMedMealTiming: "none" as "before" | "after" | "none"
  });

  // Socket for hardware simulations
  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);
    
    newSocket.on("notification", (data: LogEntry) => {
      if (data.type === "alert") {
        setIsAlerting(true);
        setLatestAlert(data);
      }
    });

    return () => {
      newSocket.close();
    };
  }, []);

  // Firebase Patients Listener
  useEffect(() => {
    if (!user) return;

    const patientsRef = collection(db, 'patients');
    const q = isAdmin ? patientsRef : query(patientsRef, where('ownerId', '==', user.uid));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const pData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Patient));
      setPatients(pData);
      if (pData.length > 0 && !selectedPatientId) {
        setSelectedPatientId(pData[0].id);
      }
    }, (err) => {
      console.error("Patients fetch error:", err);
    });

    return unsubscribe;
  }, [user, isAdmin]);

  // Firebase Sub-data Listeners
  useEffect(() => {
    if (!selectedPatientId || !user) return;

    // Vitals
    const vitalsRef = collection(db, 'vitals');
    const vQ = query(vitalsRef, where('patientId', '==', selectedPatientId), orderBy('timestamp', 'desc'), limit(50));
    const vUnsub = onSnapshot(vQ, (snap) => {
      setVitalsData(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as VitalEntry)));
    });

    // Schedules
    const schedRef = collection(db, 'schedules');
    const sQ = query(schedRef, where('patientId', '==', selectedPatientId));
    const sUnsub = onSnapshot(sQ, (snap) => {
      const raw = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ScheduleItem));
      setSchedules(raw.sort((a,b) => a.time.localeCompare(b.time)));
    });

    // Contacts
    const contactRef = collection(db, 'contacts');
    const cQ = query(contactRef, where('patientId', '==', selectedPatientId));
    const cUnsub = onSnapshot(cQ, (snap) => {
      setContacts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contact)));
    });

    // Logs
    const logRef = collection(db, 'logs');
    const lQ = query(logRef, where('patientId', '==', selectedPatientId), orderBy('timestamp', 'desc'), limit(30));
    const lUnsub = onSnapshot(lQ, (snap) => {
      setLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as LogEntry)));
    });

    return () => {
      vUnsub();
      sUnsub();
      cUnsub();
      lUnsub();
    };
  }, [selectedPatientId, user]);

  // Status updates (local derived)
  useEffect(() => {
    if (!selectedPatientId) return;
    const patient = patients.find(p => p.id === selectedPatientId);
    const nextItem = schedules.find(s => s.status === "pending");
    
    setStatus({
      online: true,
      patient_name: patient?.name || "Loading...",
      patient_id: selectedPatientId,
      last_sync: new Date().toISOString(),
      next_medication: nextItem || null
    });
  }, [selectedPatientId, schedules, patients]);

  const handleAddPatient = async (patient: any) => {
    if (!user) return;
    try {
      const docRef = await addDoc(collection(db, 'patients'), {
        ...patient,
        ownerId: user.uid,
        age: Number(patient.age)
      });
      setSelectedPatientId(docRef.id);
      setIsPatientModalOpen(false);
      simulateAction("New Profile", `Added ${patient.name} to family dashboard`, "success");
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'patients');
    }
  };

  const handleAddContact = async (contact: any) => {
    try {
      await addDoc(collection(db, 'contacts'), {
        ...contact,
        patientId: selectedPatientId,
      });
      simulateAction("Contact Added", `Added ${contact.name} to Care Circle`, "success");
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'contacts');
    }
  };

  const handleRemoveContact = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'contacts', id));
      simulateAction("Contact Removed", "Updated Care Circle membership", "info");
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `contacts/${id}`);
    }
  };

  const handleDeleteSchedule = async (id: string, label: string) => {
    try {
      await deleteDoc(doc(db, 'schedules', id));
      simulateAction("Regimen Deleted", `Removed schedule for '${label}'`, "info", id);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `schedules/${id}`);
    }
  };

  const simulateAction = (event: string, detail: string, type: string, schedule_id?: string, pId?: string) => {
    // Also save to Firestore Logs
    addDoc(collection(db, 'logs'), {
      patientId: pId || selectedPatientId,
      timestamp: new Date().toISOString(),
      event: `${event}: ${detail || ""}`,
      type: type || "info",
    }).catch(err => console.error("Log error:", err));

    // Optional: Real appliance update simulation still goes through server bridge
    fetch("/api/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, detail, type, schedule_id, patientId: pId || selectedPatientId })
    });
  };

  const handleAddVital = async (vital: any) => {
    try {
      const record = {
        ...vital,
        patientId: selectedPatientId,
        timestamp: new Date().toISOString(),
        value: Number(vital.value),
        value2: vital.value2 ? Number(vital.value2) : null,
      };
      await addDoc(collection(db, 'vitals'), record);
      
      simulateAction("Vital Recorded", `New ${vital.type.replace('_', ' ')} reading saved: ${vital.value}${vital.value2 ? '/'+vital.value2 : ''} ${vital.unit}`, "success");
      
      const vitalsStatus = getVitalStatus(vital.type, Number(vital.value), vital.value2 ? Number(vital.value2) : undefined);
      if (vitalsStatus.severity === 'alert' || vitalsStatus.severity === 'warning') {
         setTimeout(() => {
           simulateAction("Health Alert", `ABNORMAL READING: ${vitalsStatus.label} detected. Caregiver notified.`, "alert");
         }, 800);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'vitals');
    }
  };

  const handleAddEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const entry = {
        ...newEntry,
        patientId: selectedPatientId,
        pills: newEntry.pills.split(",").map(p => p.trim()),
        status: 'pending'
      };
      await addDoc(collection(db, 'schedules'), entry);
      setIsAddModalOpen(false);
      setNewEntry({ time: "08:00", label: "", pills: "", mealTiming: "none" });
      simulateAction("New Regimen Added", `Scheduled ${entry.label} at ${entry.time}`, "success");
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'schedules');
    }
  };

  const handleRefillSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Build details about what was refilled
      const medsList = [...refillData.selectedMeds];
      if (refillData.customMedsText.trim()) {
        medsList.push(...refillData.customMedsText.split(",").map(m => m.trim()));
      }
      
      const refilledMedsStr = medsList.length > 0 ? medsList.join(", ") : "All medications";
      const refillLogText = `Stock Refill: ${refilledMedsStr} refilled to standard ${refillData.daysOfSupply}-day capacity.`;
      
      let newMedLogText = "";
      // If adding new medication schedule
      if (refillData.isAddingNewMed && refillData.newMedLabel && refillData.newMedPills) {
        const newSched = {
          patientId: selectedPatientId,
          time: refillData.newMedTime,
          label: refillData.newMedLabel,
          pills: refillData.newMedPills.split(",").map(p => p.trim()),
          mealTiming: refillData.newMedMealTiming,
          status: 'pending' as const
        };
        await addDoc(collection(db, 'schedules'), newSched);
        newMedLogText = ` New regimen added: '${refillData.newMedLabel}' at ${refillData.newMedTime}.`;
      }

      simulateAction("Medication Refilled", `${refillLogText}${newMedLogText}`, "success");
      
      setIsRefillModalOpen(false);
      setRefillData({
        selectedMeds: [],
        daysOfSupply: "30",
        customMedsText: "",
        isAddingNewMed: false,
        newMedTime: "08:00",
        newMedLabel: "",
        newMedPills: "",
        newMedMealTiming: "none"
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'schedules');
    }
  };

  const askAi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isAiTyping) return;

    const userMsg: ChatMessage = { role: "user", parts: [{ text: chatInput }] };
    setChatHistory(prev => [...prev, userMsg]);
    setChatInput("");
    setIsAiTyping(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatInput, history: chatHistory }),
      });
      const data = await res.json();
      const modelMsg: ChatMessage = { role: "model", parts: [{ text: data.text }] };
      setChatHistory(prev => [...prev, modelMsg]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsAiTyping(false);
    }
  };

  const simulateScan = () => {
    setIsScanning(true);
    simulateAction("Prescription Uploaded", "Document analysis in progress via Gemini OCR", "info");
    
    setTimeout(() => {
        setIsScanning(false);
        simulateAction("Scanner Success", "Added 'Atorvastatin (Nightly)' to regimen", "success");
    }, 3000);
  };

  const currentSchedules = schedules.filter(s => s.patientId === selectedPatientId);
  const uniqueMedicines = Array.from(new Set(currentSchedules.flatMap(s => s.pills || []))).filter(Boolean);
  const currentLogs = logs.filter(l => !l.patientId || l.patientId === selectedPatientId);

  const takenCount = currentSchedules.filter(s => s.status === 'taken').length;
  const totalCount = currentSchedules.length;
  const progress = totalCount > 0 ? (takenCount / totalCount) * 100 : 0;

  const NavButton = ({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) => (
    <button 
      onClick={onClick}
      className={`relative flex items-center gap-2.5 px-4 md:px-5 py-2.5 rounded-xl text-sm font-black transition-all ${
        active 
          ? 'bg-white text-slate-900 shadow-sm' 
          : 'text-slate-400 hover:text-slate-600'
      }`}
    >
      {active ? <motion.div layoutId="nav-bg" className="absolute inset-0 bg-white rounded-xl shadow-sm -z-0" /> : null}
      <span className="relative z-10 flex items-center gap-2.5">
        {icon}
        <span className={active ? 'block text-xs md:text-sm' : 'hidden lg:block'}>{label}</span>
      </span>
    </button>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center">
        <div className="flex flex-col items-center gap-6">
           <div className="w-16 h-16 border-4 border-teal-500/20 border-t-teal-500 rounded-full animate-spin" />
           <span className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400 animate-pulse">Syncing Medimate...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] text-slate-900 font-sans selection:bg-teal-100 flex flex-col items-center justify-center p-6 bg-[radial-gradient(circle_at_top_right,_rgba(20,184,166,0.05),transparent_600px)]">
        <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center">
          <div className="space-y-6 md:space-y-8">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 md:w-16 md:h-16 bg-linear-to-tr from-[#3ABBB3] via-[#6AC780] to-[#99D54D] rounded-2xl md:rounded-3xl flex items-center justify-center text-white shadow-2xl shadow-teal-500/30 transform rotate-[10deg]">
                <Bell className="w-6 h-6 md:w-8 md:h-8 transform rotate-[-10deg]" />
              </div>
              <div className="text-3xl md:text-4xl font-black tracking-tighter leading-none text-slate-900">
                <span>MED</span>
                <span className="text-[#84cc16] mx-[1px]">I</span>
                <span>MATE</span>
              </div>
            </div>
            
            <h1 className="text-4xl md:text-7xl font-black tracking-tighter text-slate-900 leading-[0.9]">
              Family Care,<br/>
              <span className="text-teal-600">Simplified.</span>
            </h1>
            
            <p className="text-lg md:text-xl font-medium text-slate-400 max-w-sm leading-relaxed">
              The world's first smart medication adherence system for multi-generational families.
            </p>

            <div className="flex flex-col gap-4">
              <button 
                onClick={signInWithGoogle}
                className="group relative flex items-center justify-center gap-4 bg-slate-900 text-white px-6 md:px-8 py-5 md:py-6 rounded-[24px] md:rounded-[32px] font-black text-base md:text-lg tracking-tight hover:bg-slate-800 transition-all shadow-2xl shadow-slate-900/20 overflow-hidden"
              >
                <div className="absolute inset-0 bg-linear-to-tr from-teal-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <LogIn size={24} />
                <span>Sign in with Google</span>
              </button>
              <div className="flex items-center gap-3 px-2">
                <ShieldAlert size={14} className="text-slate-300" />
                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Hi-Fi Encryption Active</span>
              </div>
            </div>
          </div>

          <div className="relative hidden md:block">
            <div className="absolute inset-0 bg-teal-500/10 blur-[120px] rounded-full" />
            <div className="bg-white p-10 rounded-[60px] shadow-2xl border border-white relative z-10 space-y-8 transform rotate-2">
               <div className="flex items-center justify-between">
                 <div className="h-4 w-24 bg-slate-100 rounded-full" />
                 <div className="h-8 w-8 bg-[#84cc16] rounded-xl" />
               </div>
               <div className="space-y-4">
                 <div className="h-12 w-full bg-slate-50 rounded-2xl" />
                 <div className="h-12 w-4/5 bg-slate-50 rounded-2xl opacity-50" />
               </div>
               <div className="pt-8 flex items-center justify-between">
                 <div className="flex -space-x-3">
                   {[1,2,3].map(i => <div key={i} className="w-10 h-10 rounded-full border-4 border-white bg-slate-200" />)}
                 </div>
                 <div className="h-10 w-24 bg-teal-500 rounded-2xl" />
               </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] text-slate-900 font-sans selection:bg-teal-100">
      {/* Top Tagline Banner */}
      <div className="w-full bg-slate-900 text-white/70 py-1.5 text-center overflow-hidden border-b border-white/5 z-50 relative">
        <motion.p 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-[9px] font-black uppercase tracking-[0.4em] flex items-center justify-center gap-4"
        >
          <span className="opacity-40">•</span>
          YOUR HEALTH COMPANION
          <span className="opacity-40">•</span>
          SMART ADHERENCE SYSTEM
          <span className="opacity-40">•</span>
        </motion.p>
      </div>

      {/* Emergency Overlay - Ultra High Stakes */}
      <AnimatePresence>
        {isAlerting && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-red-600 flex items-center justify-center p-6"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-red-500 via-red-600 to-red-900 animate-pulse" />
            <motion.div 
              initial={{ scale: 0.8, y: 40, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              className="max-w-xl w-full relative bg-white/10 backdrop-blur-3xl border border-white/20 p-12 rounded-[40px] shadow-[0_0_100px_rgba(0,0,0,0.5)] text-center text-white"
            >
              <div className="bg-white text-red-600 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-8 shadow-2xl">
                <ShieldAlert size={48} />
              </div>
              <h1 className="text-5xl font-black mb-4 uppercase tracking-tighter leading-tight">
                Emergency<br/>Response Active
              </h1>
              <p className="text-xl mb-12 opacity-90 font-medium leading-relaxed">
                {latestAlert?.event || "The physical emergency panic button was triggered on the Medimate appliance."}
              </p>
              <div className="grid grid-cols-1 gap-4">
                <button 
                  onClick={() => setIsAlerting(false)}
                  className="w-full bg-white text-red-600 py-5 rounded-2xl font-black text-xl hover:bg-red-50 transition-all shadow-xl active:scale-95"
                >
                  DISMISS & RESET
                </button>
                <button className="w-full bg-red-700/50 border border-white/20 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2">
                   Contact Medical Services <ArrowRight size={18} />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation */}
      <nav className="sticky top-0 bg-white/60 backdrop-blur-2xl border-b border-slate-200/50 z-40 transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 md:px-8 h-20 md:h-24 flex items-center justify-between">
          <div className="flex items-center gap-3 md:gap-6">
            {/* Recreated Logo */}
            <motion.div 
              whileHover={{ rotate: 5, scale: 1.05 }}
              onClick={() => setCurrentView('dashboard')}
              className="relative cursor-pointer"
            >
              <div className="absolute -top-1 -left-0.5 text-teal-500 rotate-[-15deg] z-10">
                 <Wifi className="w-3 h-3 md:w-4 md:h-4 animate-pulse" />
              </div>
              <div className="w-10 h-10 md:w-14 md:h-14 bg-linear-to-tr from-[#3ABBB3] via-[#6AC780] to-[#99D54D] rounded-xl md:rounded-2xl flex items-center justify-center text-white shadow-xl shadow-teal-500/30 transform rotate-[10deg]">
                <div className="transform rotate-[-10deg]">
                  <Bell className="w-5 h-5 md:w-7 md:h-7 drop-shadow-[0_2px_4px_rgba(0,0,0,0.2)]" strokeWidth={2.5} />
                </div>
              </div>
            </motion.div>

            <div>
              <div className="flex items-center text-xl md:text-3xl font-black tracking-tighter leading-none text-slate-800">
                <span>MED</span>
                <span className="text-[#84cc16] mx-[0.5px] md:mx-[1px]">I</span>
                <span>MATE</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <div className={`w-1.5 h-1.5 rounded-full ring-2 ring-white ${status?.online ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                <span className="text-[8px] md:text-[10px] uppercase tracking-[0.2em] font-black text-slate-400">
                  {status?.online ? 'Active' : 'Offline'}
                </span>
              </div>
            </div>

            <div className="hidden lg:flex items-center gap-1 bg-slate-100 p-1.5 rounded-[20px] ml-12 relative">
              <NavButton active={currentView === 'dashboard'} onClick={() => setCurrentView('dashboard')} icon={<LayoutDashboard size={18} />} label="Dashboard" />
              <NavButton active={currentView === 'vitals'} onClick={() => setCurrentView('vitals')} icon={<Heart size={18} />} label="Vitals" />
              <NavButton active={currentView === 'contacts'} onClick={() => setCurrentView('contacts')} icon={<Phone size={18} />} label="Care Circle" />
              <NavButton active={currentView === 'reports'} onClick={() => setCurrentView('reports')} icon={<FileText size={18} />} label="Insights" />
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-8">
            <div className="hidden md:block h-10 w-px bg-slate-200" />
            
            {/* Multi-Profile Selector - Condensed on Mobile */}
            <div className="flex items-center bg-slate-100/80 p-1 md:p-1.5 rounded-xl md:rounded-[22px] border border-slate-200/50 shadow-inner overflow-hidden max-w-[120px] md:max-w-none">
               <div className="hidden sm:flex -space-x-1 mr-3">
                 {patients.slice(0, 3).map((p, i) => (
                   <div 
                    key={p.id}
                    className={`w-6 h-6 md:w-7 md:h-7 rounded-lg md:rounded-xl border-2 border-white flex items-center justify-center text-[7px] md:text-[8px] font-black uppercase text-white shadow-sm ring-1 ring-slate-200/50 ${
                      p.gender === 'Female' ? 'bg-rose-400' : 'bg-teal-500'
                    }`}
                   >
                     {p.name[0]}
                   </div>
                 ))}
               </div>
               <div className="flex items-center gap-1">
                 {patients.map(p => (
                   <button 
                    key={p.id}
                    onClick={() => setSelectedPatientId(p.id)}
                    className={`px-3 md:px-4 py-1.5 md:py-2 rounded-lg md:rounded-xl text-[8px] md:text-[10px] font-black uppercase tracking-widest transition-all duration-300 whitespace-nowrap ${
                      selectedPatientId === p.id 
                      ? 'bg-white text-slate-900 shadow-md transform scale-105' 
                      : 'text-slate-400 hover:text-slate-600 hover:bg-white/40'
                    }`}
                   >
                     {p.name.split(' ')[0]}
                   </button>
                 ))}
                 <button 
                  onClick={() => setIsPatientModalOpen(true)}
                  className="w-7 h-7 md:w-8 md:h-8 rounded-lg md:rounded-xl bg-slate-900 text-white flex items-center justify-center hover:bg-teal-600 hover:scale-105 active:scale-95 transition-all shadow-lg"
                  title="Add Family Member"
                 >
                   <Plus size={12} />
                 </button>
               </div>
            </div>

            <div className="hidden sm:flex items-center gap-2">
              <button 
                onClick={() => setIsHardwareModalOpen(true)}
                className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-teal-600 hover:bg-teal-50/50 hover:border-teal-200 transition-all shadow-sm flex items-center gap-1.5"
                title="Hardware Box integration"
              >
                <Cpu size={16} className="text-teal-600 animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap">Hardware Sync</span>
              </button>
              <button 
                onClick={() => {
                  const directUrl = "https://ais-pre-nvw3ppmastrrebzeb4u2wa-640743221145.asia-southeast1.run.app";
                  navigator.clipboard.writeText(directUrl);
                  simulateAction("Link Copied", "App URL copied for sharing", "success");
                }}
                className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-teal-600 transition-all shadow-sm"
                title="Copy App URL"
              >
                <Share2 size={16} />
              </button>
              <button 
                onClick={() => signOut(auth)}
                className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-red-600 transition-all shadow-sm"
                title="Logout"
              >
                <LogOut size={16} />
              </button>
            </div>

            <button className="flex items-center gap-2 md:gap-4 bg-white border border-slate-200 p-1 md:p-1.5 md:pr-5 rounded-full shadow-sm hover:shadow-md transition-all group">
              <div className="w-8 h-8 md:w-9 md:h-9 bg-teal-50 rounded-full flex items-center justify-center text-teal-600 group-hover:bg-teal-600 group-hover:text-white transition-colors overflow-hidden shrink-0">
                {user?.photoURL ? <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" /> : <User size={16} />}
              </div>
              <div className="hidden sm:flex flex-col text-left">
                <span className="font-bold text-xs md:text-sm text-slate-700 truncate max-w-[80px]">{user?.displayName?.split(' ')[0] || 'User'}</span>
                {isAdmin && <span className="text-[7px] font-black uppercase text-amber-600 tracking-widest">Admin</span>}
              </div>
            </button>
          </div>
        </div>
        
        {/* Mobile Nav Scroller */}
        <div className="lg:hidden flex items-center gap-1 bg-white px-4 pb-3 overflow-x-auto no-scrollbar">
          <NavButton active={currentView === 'dashboard'} onClick={() => setCurrentView('dashboard')} icon={<LayoutDashboard size={16} />} label="Dashboard" />
          <NavButton active={currentView === 'vitals'} onClick={() => setCurrentView('vitals')} icon={<Heart size={16} />} label="Vitals" />
          <NavButton active={currentView === 'contacts'} onClick={() => setCurrentView('contacts')} icon={<Phone size={16} />} label="Circle" />
          <NavButton active={currentView === 'reports'} onClick={() => setCurrentView('reports')} icon={<FileText size={16} />} label="Insights" />
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-10">
        
        {currentView === 'dashboard' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-12 gap-6 auto-rows-[160px]"
          >
            {/* Main Card: Next Dose (Large) */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="md:col-span-4 lg:col-span-8 row-span-1 md:row-span-2 bg-white rounded-[32px] md:rounded-[40px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white p-6 md:p-10 flex flex-col justify-between overflow-hidden relative group transition-all"
            >
              <div className="absolute top-0 right-0 w-48 md:w-64 h-48 md:h-64 bg-teal-50 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl opacity-50 group-hover:bg-teal-100 transition-colors" />
              
              <div className="relative z-10 flex flex-col md:flex-row items-start justify-between gap-6 md:gap-0">
                <div>
                  <div className="flex items-center gap-3 mb-4 md:mb-6">
                    <div className="bg-teal-600 p-2 md:p-3 rounded-xl md:rounded-2xl text-white shadow-lg shadow-teal-600/20">
                      <Clock className="w-5 h-5 md:w-6 md:h-6" />
                    </div>
                    <h2 className="text-[10px] md:text-xs uppercase font-black tracking-widest text-slate-400">Scheduled Dispensation</h2>
                  </div>
                  <h1 className="text-5xl md:text-8xl font-black text-slate-900 tracking-tighter mb-1 md:mb-2 italic">
                    {status?.next_medication?.time || '--:--'}
                  </h1>
                  <p className="text-xl md:text-2xl font-bold text-slate-400">
                    {status?.next_medication?.label || 'Queue is currently empty'}
                  </p>
                </div>

                {status?.next_medication && (
                  <div className="bg-slate-50 border border-slate-100 rounded-2xl md:rounded-3xl p-4 md:p-6 flex flex-col items-center min-w-[120px] md:min-w-[140px] self-start md:self-auto">
                    <span className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 md:mb-4">Pill Count</span>
                    <div className="flex -space-x-3 md:-space-x-4 mb-3 md:mb-4">
                      {status.next_medication.pills.map((p, i) => (
                        <motion.div 
                          initial={{ x: 20, opacity: 0 }}
                          animate={{ x: 0, opacity: 1 }}
                          transition={{ delay: i * 0.1 }}
                          key={i} 
                          className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-white shadow-md border border-slate-100 flex items-center justify-center text-xs md:text-sm font-black text-teal-600 uppercase"
                        >
                          {p[0]}
                        </motion.div>
                      ))}
                    </div>
                    <span className="text-[10px] md:text-xs font-bold text-slate-600">{status.next_medication.pills.length} Units</span>
                  </div>
                )}
              </div>

              <div className="relative z-10 flex flex-col md:flex-row items-center justify-between pt-6 md:pt-8 border-t border-slate-100 gap-4 md:gap-0 mt-6 md:mt-0">
                <div className="flex items-center gap-4 self-start md:self-auto">
                   <div className="flex items-center gap-1">
                      {[1,2,3,4].map(i => (
                        <div key={i} className={`w-1.5 h-6 rounded-full ${i <= 2 ? 'bg-teal-500' : 'bg-slate-200'}`} />
                      ))}
                   </div>
                   <span className="text-[10px] md:text-xs font-bold text-slate-500">Wait for appliance lid to lift</span>
                </div>
                <motion.button 
                  whileHover={{ x: 5 }}
                  onClick={() => simulateAction("Dose Taken", `Manual override for ${status?.next_medication?.label}`, "success", status?.next_medication?.id)}
                  className="w-full md:w-auto bg-teal-600 text-white px-6 md:px-8 py-3.5 md:py-4 rounded-xl md:rounded-2xl font-black text-xs md:text-sm tracking-widest uppercase flex items-center justify-center gap-3 shadow-lg shadow-teal-600/20 hover:bg-teal-700 active:scale-95 transition-all"
                >
                  Confirm Collection <ArrowRight size={18} />
                </motion.button>
              </div>
            </motion.div>

            {/* Quick Action: Panic (Medium) */}
            <motion.button 
               initial={{ opacity: 0, x: 20 }}
               animate={{ opacity: 1, x: 0 }}
               whileHover={{ y: -5 }}
               onClick={() => simulateAction("Panic Pressed", "Caregiver notified via emergency button", "alert")}
               className="md:col-span-2 lg:col-span-4 row-span-1 bg-red-600 text-white rounded-[32px] md:rounded-[40px] p-6 md:p-8 flex flex-col justify-between items-start shadow-xl shadow-red-600/20 group relative overflow-hidden active:scale-95 transition-transform"
            >
              <div className="absolute top-0 right-0 p-6 md:p-8 opacity-20 transform translate-x-1/4 -translate-y-1/4 group-hover:scale-110 transition-transform">
                <ShieldAlert className="w-24 h-24 md:w-28 md:h-28" />
              </div>
              <ShieldAlert className="w-7 h-7 md:w-8 md:h-8" />
              <div className="text-left">
                <h3 className="text-lg md:text-xl font-black uppercase tracking-tighter mb-1">Trigger Panic</h3>
                <p className="text-[10px] md:text-xs font-bold text-red-100">Instant caregiver alert</p>
              </div>
            </motion.button>

            {/* Progress Circle (Medium) */}
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="md:col-span-2 lg:col-span-4 row-span-1 bg-white rounded-[32px] md:rounded-[40px] p-6 md:p-8 border border-white shadow-sm flex items-center justify-between gap-4 md:gap-6"
            >
              <div className="relative w-16 h-16 md:w-20 md:h-20 flex items-center justify-center shrink-0">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="34" className="stroke-slate-100 fill-none" strokeWidth="6" />
                  <motion.circle 
                    cx="40" cy="40" r="34" 
                    className="stroke-[#84cc16] fill-none" 
                    strokeWidth="6"
                    strokeDasharray={213.6}
                    initial={{ strokeDashoffset: 213.6 }}
                    animate={{ strokeDashoffset: 213.6 - (progress / 100) * 213.6 }}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-lg md:text-xl font-black text-slate-800 leading-none">{Math.round(progress)}%</span>
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Compliance</h3>
                <p className="text-base md:text-lg font-black text-slate-800">{takenCount}/{totalCount} Done</p>
                <div className="mt-1 text-[8px] md:text-[10px] font-bold text-slate-400 flex items-center gap-1.5">
                   <div className="w-1.5 h-1.5 rounded-full bg-[#84cc16]" /> Consistent!
                </div>
              </div>
            </motion.div>

            {/* Schedule List (Spanning) */}
            <section className="md:col-span-4 lg:col-span-8 row-span-3 space-y-4 md:space-y-6 mt-4 md:mt-0">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-2 gap-4">
                <h3 className="text-xl md:text-2xl font-black tracking-tight text-slate-800 flex items-center gap-3">
                  <Calendar className="w-5.5 h-5.5 md:w-6 md:h-6 text-[#84cc16]" />
                  Daily Regimen
                </h3>
                <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                  <button 
                    onClick={simulateScan}
                    disabled={isScanning}
                    className="flex-1 sm:flex-none bg-slate-900 text-white px-4 md:px-5 py-3 rounded-xl md:rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-widest flex items-center justify-center gap-2 md:gap-3 hover:bg-slate-800 shadow-xl shadow-slate-900/20 transition-all disabled:opacity-50"
                  >
                    {isScanning ? (
                      <div className="w-3 h-3 md:w-4 md:h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : <Activity className="w-3.5 h-3.5 md:w-4 md:h-4" />}
                    Scan
                  </button>
                  <button 
                    onClick={() => setIsAddModalOpen(true)}
                    className="flex-1 sm:flex-none bg-white border border-slate-200 px-4 md:px-6 py-3 rounded-xl md:rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-slate-50 shadow-sm transition-all"
                  >
                    <Plus className="w-3.5 h-3.5 md:w-4 md:h-4" /> New Entry
                  </button>
                  <button 
                    onClick={() => setIsRefillModalOpen(true)}
                    className="flex-1 sm:flex-none bg-[#84cc16] hover:bg-lime-600 text-slate-950 px-4 md:px-6 py-3 rounded-xl md:rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-lime-500/20 transition-all"
                  >
                    <RefreshCw className="w-3.5 h-3.5 md:w-4 md:h-4" /> Refill Stock
                  </button>
                </div>
              </div>
              
              <div className="grid grid-cols-1 gap-4">
                <AnimatePresence mode="popLayout">
                  {currentSchedules.map((item, idx) => (
                    <motion.div 
                      layout
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      key={item.id}
                      className={`group bg-white p-5 rounded-[32px] border transition-all ${
                        item.status === 'taken' ? 'border-green-100 bg-green-50/10' : 
                        item.status === 'missed' ? 'border-red-100 bg-red-50/10' : 
                        'border-white shadow-sm hover:shadow-md'
                      } flex items-center gap-6`}
                    >
                      <div className={`w-20 h-20 rounded-3xl flex flex-col items-center justify-center font-mono font-black border group-hover:scale-105 transition-transform ${
                        item.status === 'taken' ? 'bg-green-100 text-green-700 border-green-200' : 
                        item.status === 'missed' ? 'bg-red-100 text-red-700 border-red-200' : 
                        'bg-slate-50 text-slate-500 border-slate-100'
                      }`}>
                        <span className="text-xs opacity-50 mb-0.5">TIME</span>
                        <span className="text-lg">{item.time}</span>
                      </div>
                      
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-1">
                          <h4 className="text-xl font-bold text-slate-800 tracking-tight">{item.label}</h4>
                          {item.status === 'taken' && (
                            <span className="bg-green-500 text-white text-[9px] uppercase tracking-widest px-2.5 py-1 rounded-lg font-black shadow-lg shadow-green-500/20">
                              Verified
                            </span>
                          )}
                          {item.status === 'missed' && (
                            <span className="bg-red-500 text-white text-[9px] uppercase tracking-widest px-2.5 py-1 rounded-lg font-black shadow-lg shadow-red-500/20">
                              Delayed
                            </span>
                          )}
                          {item.mealTiming !== 'none' && (
                            <span className="bg-amber-100 text-amber-700 text-[9px] uppercase tracking-widest px-2.5 py-1 rounded-lg font-black border border-amber-200">
                              {item.mealTiming === 'before' ? 'Before Meal' : 'After Meal'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                           {item.pills && item.pills.map((pill, i) => (
                             <span key={i} className="text-xs font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">{pill}</span>
                           ))}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {deletingId === item.id ? (
                          <div className="flex items-center gap-1.5 animate-fade-in">
                            <button 
                              onClick={() => {
                                handleDeleteSchedule(item.id, item.label);
                                setDeletingId(null);
                              }}
                              className="px-3.5 py-2.5 bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-700 transition-all shadow-sm"
                            >
                              Confirm
                            </button>
                            <button 
                              onClick={() => setDeletingId(null)}
                              className="px-3 py-2.5 bg-slate-100 text-slate-500 hover:text-slate-800 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            {item.status === 'pending' && (
                              <button 
                                onClick={() => simulateAction("Dose Alert", `${item.label} notification triggered`, "info", item.id)}
                                className="p-3 bg-teal-50 text-teal-600 rounded-2xl hover:bg-teal-600 hover:text-white transition-all shadow-sm"
                                title="Trigger Dose Notification Alert"
                              >
                                <Bell size={18} />
                              </button>
                            )}
                            <button 
                              onClick={() => setDeletingId(item.id)}
                              className="p-3 bg-rose-50 text-rose-500 rounded-2xl hover:bg-rose-600 hover:text-white border border-rose-100 hover:border-rose-600 transition-all shadow-sm"
                              title="Delete medicine from regimen"
                            >
                              <Trash2 size={18} />
                            </button>
                          </>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </section>

            {/* Right Column: Live Feed (Large Row Spanning) */}
            <div className="md:col-span-4 lg:col-span-4 row-span-3">
              <div className="bg-slate-900 text-white rounded-[40px] shadow-2xl flex flex-col h-full overflow-hidden border border-white/5 relative">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-teal-500/10 via-transparent to-transparent pointer-events-none" />
                
                <div className="p-8 pb-4 border-b border-white/10 relative z-10 flex items-center justify-between">
                  <h3 className="text-lg font-black flex items-center gap-3 tracking-tighter">
                    <div className="w-2 h-2 rounded-full bg-[#84cc16] animate-pulse" />
                    Live Event Feed
                  </h3>
                  <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Syncing...</span>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-6 relative z-10 custom-scrollbar">
                  <AnimatePresence initial={false}>
                    {currentLogs.map((log, i) => (
                      <motion.div 
                        key={log.id + i}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="group flex gap-5"
                      >
                        <div className="flex flex-col items-center pt-2">
                          <div className={`w-3 h-3 rounded-full ring-4 ring-slate-900 ${
                            log.type === 'alert' ? 'bg-red-500' : 
                            log.type === 'success' ? 'bg-green-500' : 
                            log.type === 'warning' ? 'bg-amber-500' : 
                            'bg-teal-400'
                          }`} />
                          <div className="w-px flex-1 bg-white/5 my-2 group-last:hidden" />
                        </div>
                        <div className="pb-2">
                          <p className="text-[10px] font-mono font-bold text-white/40 mb-1.5 tracking-widest uppercase">
                            {log.timestamp ? format(new Date(log.timestamp), 'HH:mm:ss') : '--:--:--'} • DASHBOARD
                          </p>
                          <p className={`text-sm font-black leading-snug tracking-tight ${
                            log.type === 'alert' ? 'text-red-400' : 
                            log.type === 'warning' ? 'text-amber-400' :
                            log.type === 'success' ? 'text-[#84cc16]' :
                            'text-white'
                          }`}>
                            {log.event}
                          </p>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>

                {/* Status Footer */}
                <div className="p-8 bg-white/5 backdrop-blur-md border-t border-white/10 relative z-10">
                   <div className="flex items-center justify-between mb-4">
                      <span className="text-[10px] font-black uppercase text-white/40 tracking-[0.2em]">Caregiver Monitoring</span>
                      <div className="flex -space-x-2">
                         {[1,2,3].map(i => (
                           <div key={i} className="w-6 h-6 rounded-full border-2 border-slate-900 bg-slate-700 flex items-center justify-center text-[8px] font-black">{i}</div>
                         ))}
                      </div>
                   </div>
                   <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: "88%" }}
                        className="h-full bg-teal-500 rounded-full"
                      />
                   </div>
                </div>
              </div>
            </div>

          </motion.div>
        )}

        {currentView === 'vitals' && (
          <VitalsView data={vitalsData} onAdd={handleAddVital} />
        )}

        {currentView === 'contacts' && (
          <ContactsView data={contacts} onAdd={handleAddContact} onRemove={handleRemoveContact} simulateAction={simulateAction} />
        )}

        {currentView === 'reports' && (
          <ReportsView 
            schedules={schedules} 
            vitals={vitalsData} 
            simulateAction={simulateAction}
            onDownload={() => {
              const doc = new jsPDF();
              const adherence = (schedules.filter(s => s.status === 'taken').length / schedules.length) * 100 || 0;
              const navy = [30, 41, 59] as [number, number, number];
              const green = [132, 204, 22] as [number, number, number];
              const textGray = [100, 116, 139] as [number, number, number];

              // 1. LOGO & HEADER
              // Render the green bell icon logo
              doc.setFillColor(132, 204, 22);
              doc.roundedRect(20, 15, 12, 12, 3, 3, 'F');
              doc.setTextColor(255, 255, 255);
              doc.setFont("helvetica", "bold");
              doc.setFontSize(14);
              doc.text("M", 23, 24); // Representational M inside bell

              // MEDIMATE Text with Green Bar 'I'
              doc.setTextColor(navy[0], navy[1], navy[2]);
              doc.setFontSize(22);
              doc.setFont("helvetica", "bold");
              doc.text("MED", 38, 22);
              
              // The Green 'I' (Vertical Bar)
              doc.setFillColor(green[0], green[1], green[2]);
              doc.rect(57, 16.5, 2.5, 6, 'F');
              
              doc.setTextColor(navy[0], navy[1], navy[2]);
              doc.text("MATE", 61.5, 22);

              // Blocky "HEALTH REPORT" subtitle
              doc.setFontSize(28);
              doc.setTextColor(100, 100, 100);
              doc.setFont("helvetica", "bold");
              doc.text("HEALTH REPORT", 38, 34);
              
              // Horizontal Divider
              doc.setDrawColor(240, 240, 240);
              doc.line(20, 42, 190, 42);

              // Metadata Grid
              doc.setFontSize(9);
              doc.setFont("helvetica", "bold");
              doc.setTextColor(textGray[0], textGray[1], textGray[2]);
              doc.text(`PATIENT: ${status?.patient_name?.toUpperCase() || 'ADITYA MISHRA'}`, 20, 52);
              doc.text(`ID: MED-992-UX`, 20, 58);
              doc.text(`GENERATED: ${format(new Date(), 'PPP').toUpperCase()}`, 140, 52);
              doc.text(`PERIOD: LAST 7 DAYS`, 140, 58);

              // 2. SECTION: MEDICATION ADHERENCE SUMMARY
              doc.setFontSize(10);
              doc.setTextColor(textGray[0], textGray[1], textGray[2]);
              doc.text("MEDICATION ADHERENCE SUMMARY", 105, 75, { align: "center" });
              doc.setDrawColor(230, 230, 230);
              doc.line(65, 78, 145, 78);

              // Summary Box
              doc.setFillColor(250, 250, 250);
              doc.roundedRect(20, 85, 170, 32, 5, 5, 'F');
              
              doc.setFontSize(24);
              doc.setTextColor(navy[0], navy[1], navy[2]);
              doc.text(`${Math.round(adherence)}%`, 30, 108);
              doc.setFontSize(9);
              doc.text("OVERALL COMPLIANCE", 30, 95);
              
              doc.setFontSize(9);
              doc.setTextColor(textGray[0], textGray[1], textGray[2]);
              doc.text("DISTRIBUTION", 90, 95);
              doc.setFont("helvetica", "normal");
              doc.text(`Doses Taken: ${schedules.filter(s => s.status === 'taken').length}`, 90, 102);
              doc.text(`Doses Missed: ${schedules.filter(s => s.status === 'missed').length}`, 90, 108);

              doc.setFont("helvetica", "bold");
              doc.text("STATUS", 150, 95);
              doc.setTextColor(adherence >= 90 ? green[0] : 220, adherence >= 90 ? green[1] : 38, adherence >= 90 ? green[2] : 38);
              doc.text(adherence >= 90 ? "OPTIMAL" : "CRITICAL", 150, 108);

              // 3. SECTION: VITAL SIGN ANALYSIS
              doc.setTextColor(textGray[0], textGray[1], textGray[2]);
              doc.setFontSize(10);
              doc.text("VITAL SIGN ANALYSIS", 105, 135, { align: "center" });
              doc.line(75, 138, 135, 138);

              const latestBP = vitalsData.find(v => v.type === 'blood_pressure');
              const latestSugar = vitalsData.find(v => v.type === 'blood_sugar');
              const latestHR = vitalsData.find(v => v.type === 'heart_rate');

              const drawVitalRow = (label: string, value: string, y: number, color: [number, number, number]) => {
                doc.setDrawColor(color[0], color[1], color[2]);
                doc.setLineWidth(1);
                doc.line(20, y, 20, y + 12);
                doc.setFontSize(8);
                doc.setFont("helvetica", "bold");
                doc.setTextColor(textGray[0], textGray[1], textGray[2]);
                doc.text(label.toUpperCase(), 25, y + 3);
                doc.setFontSize(14);
                doc.setTextColor(navy[0], navy[1], navy[2]);
                doc.text(value, 25, y + 11);
                
                doc.setFontSize(8);
                doc.setFont("helvetica", "italic");
                doc.setTextColor(200, 200, 200);
                doc.text("Measured via Medimate Smart-Sync Appliance", 110, y + 11);
              };

              drawVitalRow("Blood Pressure (mmHg)", latestBP ? `${latestBP.value}/${latestBP.value2}` : "NON-RECORDED", 148, navy);
              drawVitalRow("Blood Sugar (mg/dL)", latestSugar ? `${latestSugar.value}` : "NON-RECORDED", 168, [249, 115, 22]);
              drawVitalRow("Heart Rate (bpm)", latestHR ? `${latestHR.value}` : "NON-RECORDED", 188, [20, 184, 166]);

              // 4. SECTION: CLINICAL OBSERVATIONS
              doc.setTextColor(textGray[0], textGray[1], textGray[2]);
              doc.setFontSize(10);
              doc.setFont("helvetica", "bold");
              doc.text("CLINICAL OBSERVATIONS", 105, 220, { align: "center" });
              doc.line(70, 223, 140, 223);

              doc.setFontSize(10);
              doc.setFont("helvetica", "normal");
              doc.setTextColor(50, 50, 50);
              const summaryText = "Patient adherence remains exceptionally high in this observation window. Vital indices for blood pressure and heart rate are stabilized within the target safety corridors. Blood glucose levels show standard post-prandial variance but no critical outliers recorded. Recommend continuing with the current scheduled medication regimen. Medimate system health is at peak performance.";
              const splitSummary = doc.splitTextToSize(summaryText, 170);
              doc.text(splitSummary, 20, 232);

              // FOOTER
              doc.setDrawColor(200, 200, 200);
              doc.line(20, 265, 80, 265);
              doc.setFontSize(8);
              doc.setTextColor(textGray[0], textGray[1], textGray[2]);
              doc.text("Attending Physician / System Verified", 20, 270);
              
              doc.setFont("helvetica", "bold");
              doc.text("CONFIDENTIAL MEDICAL DOCUMENT", 105, 285, { align: "center" });

              doc.save(`Medimate_Internal_Report_${format(new Date(), 'yyyyMMdd')}.pdf`);
              simulateAction("Report Downloaded", "Official branded PDF generated", "success");
            }}
          />
        )}

        {/* Developer Sandbox (Muted) */}
        <section className="mt-20 pt-20 border-t border-slate-200 opacity-20 hover:opacity-100 transition-opacity">
           <div className="flex flex-col items-center gap-6">
              <div className="text-[10px] uppercase font-black tracking-[0.5em] text-slate-400">Hardware Simulation Controls</div>
              <div className="flex flex-wrap items-center justify-center gap-8">
                <button onClick={() => simulateAction("Dose Alert", "Lid mechanism active: Compartment 1", "info", "1")} className="font-black text-[10px] tracking-widest uppercase border-b-2 border-transparent hover:border-slate-900 transition-all">Trigger Appliance Alert</button>
                <button onClick={() => simulateAction("Maintenance Mode", "Sensor calibration initiated", "warning")} className="font-black text-[10px] tracking-widest uppercase border-b-2 border-transparent hover:border-slate-900 transition-all">Sensor Heatmap</button>
                <button onClick={() => simulateAction("Battery Low", "Backup power 12% remaining", "warning")} className="font-black text-[10px] tracking-widest uppercase border-b-2 border-transparent hover:border-slate-900 transition-all">Power Loss Simulation</button>
                <button onClick={() => simulateAction("System Update", "Firmware v2.4.1 synced", "success")} className="font-black text-[10px] tracking-widest uppercase border-b-2 border-transparent hover:border-slate-900 transition-all">Push Update</button>
              </div>
              <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest italic pt-4">Internal build for Aditya Mishra & Naitik Joshi • The Aditya Birla Public School</p>
           </div>
        </section>

        {/* Add Patient Modal */}
        <AnimatePresence>
          {isPatientModalOpen && (
            <AddPatientModal 
              onClose={() => setIsPatientModalOpen(false)}
              onAdd={handleAddPatient}
            />
          )}
        </AnimatePresence>

        {/* Hardware Sync Modal */}
        <AnimatePresence>
          {isHardwareModalOpen && (
            <HardwareSyncModal 
              onClose={() => setIsHardwareModalOpen(false)}
              patients={patients}
              selectedPatientId={selectedPatientId}
              setSelectedPatientId={setSelectedPatientId}
              user={user}
              simulateAction={simulateAction}
            />
          )}
        </AnimatePresence>
      </main>

      {/* AI Assistant Floating Panel */}
      <AnimatePresence>
        {isAiOpen && (
          <motion.div 
            initial={{ opacity: 0, x: 200 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 200 }}
            className="fixed inset-y-4 right-4 w-96 bg-white z-50 rounded-[40px] shadow-[0_32px_64px_rgba(0,0,0,0.1)] border border-slate-200 flex flex-col overflow-hidden"
          >
            <div className="p-8 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-[#84cc16] animate-pulse" />
                  <span className="text-[10px] uppercase font-black tracking-widest text-white/50">Medimate AI</span>
                </div>
                <h3 className="text-xl font-black tracking-tight">Medical Advisor</h3>
              </div>
              <button 
                onClick={() => setIsAiOpen(false)}
                className="p-3 bg-white/10 rounded-2xl hover:bg-white/20 transition-colors"
              >
                <ChevronRight size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
              {chatHistory.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 bg-slate-50/50 rounded-[32px] border border-dashed border-slate-200">
                  <Activity size={40} className="text-teal-500 mb-4 opacity-50" />
                  <p className="text-sm font-bold text-slate-800 mb-2">Hello, I'm your Medical Advisor</p>
                  <p className="text-xs text-slate-400 font-medium">
                    You can ask me about medication doses, symptom identification, or general health tips.
                  </p>
                </div>
              )}
              {chatHistory.map((msg, i) => (
                <motion.div 
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  key={i} 
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[85%] p-4 rounded-3xl text-sm font-medium ${
                    msg.role === 'user' 
                      ? 'bg-teal-600 text-white rounded-tr-none shadow-md shadow-teal-600/10' 
                      : 'bg-slate-100 text-slate-800 rounded-tl-none border border-slate-200'
                  }`}>
                    <div className="markdown-content">
                      <ReactMarkdown>{(msg.parts && msg.parts[0] && msg.parts[0].text) || ''}</ReactMarkdown>
                    </div>
                  </div>
                </motion.div>
              ))}
              {isAiTyping && (
                <motion.div 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex justify-start"
                >
                  <div className="bg-slate-50 border border-slate-100 p-4 rounded-[20px] rounded-tl-none">
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce" />
                      <div className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                      <div className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </div>
                </motion.div>
              )}
            </div>

            <div className="p-6 border-t border-slate-100 bg-slate-50/50">
              <form onSubmit={askAi} className="relative">
                <input 
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Describe your symptoms..."
                  className="w-full bg-white border border-slate-200 rounded-2xl py-4 pl-5 pr-14 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all shadow-sm"
                />
                <button 
                  type="submit"
                  disabled={!chatInput.trim() || isAiTyping}
                  className="absolute right-2 top-2 bottom-2 w-10 bg-teal-600 text-white rounded-xl flex items-center justify-center hover:bg-teal-700 transition-colors disabled:opacity-30 disabled:hover:bg-teal-600"
                >
                  <ArrowRight size={18} />
                </button>
              </form>
              <p className="text-[9px] text-center mt-4 text-slate-400 font-bold uppercase tracking-widest leading-relaxed">
                Emergency Alert Protocol Active • Consult MD for formal diagnosis
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button 
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setIsAiOpen(true)}
        className="fixed bottom-8 right-8 w-16 h-16 bg-slate-900 text-white rounded-full flex items-center justify-center shadow-2xl z-40 border border-white/10 group overflow-hidden"
      >
        <div className="absolute inset-0 bg-linear-to-tr from-teal-500 to-green-500 opacity-0 group-hover:opacity-100 transition-opacity" />
        <Activity size={24} className="relative z-10" />
      </motion.button>

      {/* Add New Entry Modal */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               onClick={() => setIsAddModalOpen(false)}
               className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" 
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-md rounded-[40px] shadow-2xl border border-white p-8 relative z-10"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-black tracking-tight text-slate-800">Add New Dose</h3>
                <button 
                  onClick={() => setIsAddModalOpen(false)}
                  className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  <ChevronRight size={20} className="rotate-90" />
                </button>
              </div>

              <form onSubmit={handleAddEntry} className="space-y-6">
                <div>
                  <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Timing</label>
                  <input 
                    type="time" 
                    required
                    value={newEntry.time}
                    onChange={(e) => setNewEntry(prev => ({ ...prev, time: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 px-5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Label (e.g., Morning Meds)</label>
                  <input 
                    type="text" 
                    placeholder="Enter label..."
                    required
                    value={newEntry.label}
                    onChange={(e) => setNewEntry(prev => ({ ...prev, label: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 px-5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Medicines (Comma separated)</label>
                  <input 
                    type="text" 
                    placeholder="Aspirin, Vitamin C..."
                    required
                    value={newEntry.pills}
                    onChange={(e) => setNewEntry(prev => ({ ...prev, pills: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 px-5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Meal Relation</label>
                  <div className="grid grid-cols-3 gap-3">
                    {(['none', 'before', 'after'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setNewEntry(prev => ({ ...prev, mealTiming: t }))}
                        className={`py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                          newEntry.mealTiming === t 
                            ? 'bg-slate-900 text-white border-slate-900 shadow-lg' 
                            : 'bg-white text-slate-400 border-slate-100 hover:border-slate-200'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <button 
                  type="submit"
                   className="w-full bg-teal-600 text-white py-5 rounded-[24px] font-black text-sm uppercase tracking-[0.2em] shadow-xl shadow-teal-600/20 hover:scale-[1.02] active:scale-95 transition-all mt-4"
                >
                  Schedule Regimen
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {/* Medication Refill Modal */}
        {isRefillModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               onClick={() => setIsRefillModalOpen(false)}
               className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" 
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-lg rounded-[40px] shadow-2xl border border-white p-8 relative z-10 max-h-[90vh] overflow-y-auto scrollbar-none"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-lime-100 flex items-center justify-center text-lime-700">
                    <RefreshCw className="w-5 h-5 animate-spin-slow" />
                  </div>
                  <h3 className="text-2.5xl font-black tracking-tight text-slate-800">Refill Stock</h3>
                </div>
                <button 
                  onClick={() => setIsRefillModalOpen(false)}
                  className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  <ChevronRight size={20} className="rotate-90" />
                </button>
              </div>

              <form onSubmit={handleRefillSubmit} className="space-y-6 text-left">
                {/* Medicine Selection */}
                <div>
                  <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-3 font-mono">
                    Choose Medicines Refilled
                  </label>
                  
                  {uniqueMedicines.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {uniqueMedicines.map((med) => {
                        const isSelected = refillData.selectedMeds.includes(med);
                        return (
                          <button
                            key={med}
                            type="button"
                            onClick={() => {
                              if (isSelected) {
                                setRefillData(prev => ({
                                  ...prev,
                                  selectedMeds: prev.selectedMeds.filter(m => m !== med)
                                }));
                              } else {
                                setRefillData(prev => ({
                                  ...prev,
                                  selectedMeds: [...prev.selectedMeds, med]
                                }));
                              }
                            }}
                            className={`px-4 py-3 rounded-xl border text-xs font-bold text-left transition-all ${
                              isSelected 
                                ? 'bg-lime-50 border-lime-500 text-lime-700 shadow-sm' 
                                : 'bg-slate-50 border-slate-100 text-slate-600 hover:border-slate-200'
                            }`}
                          >
                            <input 
                              type="checkbox" 
                              checked={isSelected} 
                              readOnly 
                              className="mr-2 text-lime-600 focus:ring-lime-500 rounded accent-lime-600" 
                            />
                            {med}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs font-bold text-slate-400 bg-slate-50 p-4 rounded-2xl border border-slate-100 mb-3">
                      No medications are currently scheduled. You can enter prescription details manually below.
                    </p>
                  )}

                  <input 
                    type="text" 
                    placeholder="Other medications refilled (comma separated, e.g., Lipitor, Aspirin)..."
                    value={refillData.customMedsText}
                    onChange={(e) => setRefillData(prev => ({ ...prev, customMedsText: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 px-5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-lime-500/20"
                  />
                </div>

                {/* Days of Stock Added */}
                <div>
                  <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2 font-mono">
                    Supply restocked (Days of Stock)
                  </label>
                  <div className="grid grid-cols-4 gap-2 mb-2">
                    {['7', '14', '30', '90'].map(days => (
                      <button
                        key={days}
                        type="button"
                        onClick={() => setRefillData(prev => ({ ...prev, daysOfSupply: days }))}
                        className={`py-2 rounded-xl text-xs font-black transition-all ${
                          refillData.daysOfSupply === days 
                            ? 'bg-slate-900 text-white shadow-md' 
                            : 'bg-slate-50 text-slate-500 hover:bg-slate-100 border border-slate-100'
                        }`}
                      >
                        {days} Days
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={refillData.daysOfSupply}
                    onChange={(e) => setRefillData(prev => ({ ...prev, daysOfSupply: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-3 px-5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-lime-500/20 text-center"
                    placeholder="Or enter custom days..."
                  />
                </div>

                {/* Question: Do you need to change/add a schedule for new medication? */}
                <div className="bg-lime-50/50 rounded-3xl p-5 border border-lime-100 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h4 className="text-sm font-black text-slate-800">Adding new medication?</h4>
                      <p className="text-[11px] font-bold text-slate-400 mt-0.5">Would you like to schedule/change regimen times for a new medication?</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setRefillData(prev => ({ ...prev, isAddingNewMed: true }))}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-black tracking-widest uppercase transition-all ${
                          refillData.isAddingNewMed 
                            ? 'bg-[#84cc16] text-slate-950 shadow-md shadow-lime-500/20' 
                            : 'bg-white text-slate-400 border border-slate-100 hover:border-slate-200'
                        }`}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setRefillData(prev => ({ ...prev, isAddingNewMed: false }))}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-black tracking-widest uppercase transition-all ${
                          !refillData.isAddingNewMed 
                            ? 'bg-slate-900 text-white shadow-md' 
                            : 'bg-white text-slate-400 border border-slate-100 hover:border-slate-200'
                        }`}
                      >
                        No
                      </button>
                    </div>
                  </div>

                  {/* Inline Schedule form */}
                  {refillData.isAddingNewMed && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="pt-4 border-t border-slate-100 space-y-4 text-left overflow-hidden"
                    >
                      <div>
                        <label className="text-[9px] uppercase font-black tracking-widest text-slate-400 block mb-1">Medication Name & Dosage (e.g. Ramipril 5mg)</label>
                        <input 
                          type="text" 
                          placeholder="e.g. Paracetamol"
                          required={refillData.isAddingNewMed}
                          value={refillData.newMedPills}
                          onChange={(e) => setRefillData(prev => ({ ...prev, newMedPills: e.target.value }))}
                          className="w-full bg-white border border-slate-100 rounded-xl py-3 px-4 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-lime-500/20"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-[9px] uppercase font-black tracking-widest text-slate-400 block mb-1">Daily Timing Label</label>
                          <input 
                            type="text" 
                            placeholder="e.g. Early Morning"
                            required={refillData.isAddingNewMed}
                            value={refillData.newMedLabel}
                            onChange={(e) => setRefillData(prev => ({ ...prev, newMedLabel: e.target.value }))}
                            className="w-full bg-white border border-slate-100 rounded-xl py-3 px-4 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-lime-500/20"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] uppercase font-black tracking-widest text-slate-400 block mb-1">Scheduled Time</label>
                          <input 
                            type="time" 
                            required={refillData.isAddingNewMed}
                            value={refillData.newMedTime}
                            onChange={(e) => setRefillData(prev => ({ ...prev, newMedTime: e.target.value }))}
                            className="w-full bg-white border border-slate-100 rounded-xl py-3 px-4 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-lime-500/20"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[9px] uppercase font-black tracking-widest text-slate-400 block mb-1.5">Meal Relation</label>
                        <div className="grid grid-cols-3 gap-2">
                          {(['none', 'before', 'after'] as const).map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setRefillData(prev => ({ ...prev, newMedMealTiming: t }))}
                              className={`py-2 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all ${
                                refillData.newMedMealTiming === t 
                                  ? 'bg-slate-900 text-white border-slate-900 shadow-md' 
                                  : 'bg-white text-slate-400 border-slate-100 hover:border-slate-200'
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>

                <button 
                  type="submit"
                  className="w-full bg-[#84cc16] text-[#0f172a] hover:bg-lime-600 py-5 rounded-[24px] font-black text-sm uppercase tracking-[0.2em] shadow-xl shadow-lime-500/20 hover:scale-[1.02] active:scale-95 transition-all mt-4 font-sans"
                >
                  Confirm Refill & Sync Regimen
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AddPatientModal({ onClose, onAdd }: { onClose: () => void, onAdd: (p: any) => Promise<void> }) {
  const { isAdmin } = useAuth();
  const [newPatient, setNewPatient] = useState({
    name: "",
    age: "",
    gender: "Male"
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd(newPatient);
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
      <motion.div 
         initial={{ opacity: 0 }}
         animate={{ opacity: 1 }}
         exit={{ opacity: 0 }}
         onClick={onClose}
         className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" 
      />
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="bg-white w-full max-w-md rounded-[48px] shadow-2xl border border-white p-10 relative z-10"
      >
        <div className="flex items-center justify-between mb-8">
          <div>
            <h3 className="text-3xl font-black tracking-tighter text-slate-900 uppercase">New Member</h3>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
              Adding to {isAdmin ? 'Global Directory' : 'Private Dashboard'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
            <ChevronRight size={24} className="rotate-90" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Member Name</label>
            <input 
              type="text" 
              required
              placeholder="e.g. Ramesh Mishra"
              value={newPatient.name}
              onChange={(e) => setNewPatient(prev => ({ ...prev, name: e.target.value }))}
              className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 px-5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Age</label>
              <input 
                type="number" 
                required
                placeholder="65"
                value={newPatient.age}
                onChange={(e) => setNewPatient(prev => ({ ...prev, age: e.target.value }))}
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 px-5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Gender</label>
              <select 
                value={newPatient.gender}
                onChange={(e) => setNewPatient(prev => ({ ...prev, gender: e.target.value }))}
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 px-5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          <button 
            type="submit"
             className="w-full bg-[#84cc16] text-white py-5 rounded-[24px] font-black text-sm uppercase tracking-[0.2em] shadow-xl shadow-lime-600/20 hover:scale-[1.02] active:scale-95 transition-all mt-4"
          >
            Create Profile
          </button>
        </form>
      </motion.div>
    </div>
  );
}

function HardwareSyncModal({ 
  onClose, 
  patients, 
  selectedPatientId, 
  setSelectedPatientId, 
  user,
  simulateAction 
}: { 
  onClose: () => void, 
  patients: Patient[], 
  selectedPatientId: string, 
  setSelectedPatientId: (id: string) => void,
  user: any,
  simulateAction: any 
}) {
  const [activeTab, setActiveTab] = useState<'credentials' | 'arduino'>('credentials');
  const activePatient = patients.find(p => p.id === selectedPatientId);

  const sampleArduinoCode = `// ESP32 Hardware Integration Config Snippet
#define WIFI_SSID "Your_WiFi_Name"
#define WIFI_PASS "Your_WiFi_Password"

// Copy these credentials from the Medimate Dashboard
const char* HOST_SERVER = "${window.location.host}";
const char* PATIENT_ID = "${selectedPatientId || "SELECT_A_MEMBER"}";
const char* USER_UID   = "${user?.uid || "LOGIN_REQUIRED"}";

// FireStore collection reference format is:
// users/{USER_UID}/patients/{PATIENT_ID}/schedules`;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 md:p-6 overflow-y-auto">
      <motion.div 
         initial={{ opacity: 0 }}
         animate={{ opacity: 1 }}
         exit={{ opacity: 0 }}
         onClick={onClose}
         className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" 
      />
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="bg-white w-full max-w-lg rounded-[40px] shadow-2xl border border-slate-100 p-6 md:p-8 relative z-10 overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between mb-6 shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Cpu size={14} className="text-teal-600 animate-pulse" />
              <span className="text-[9px] font-black text-teal-600 uppercase tracking-widest text-left">Hardware Sync Hub</span>
            </div>
            <h3 className="text-2xl font-black tracking-tight text-slate-900 leading-none">IoT INTEGRATION</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
            <ChevronRight size={24} className="rotate-90 text-slate-400" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-slate-100 p-1 rounded-2xl mb-6 shrink-0">
          <button
            onClick={() => setActiveTab('credentials')}
            className={`flex-1 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${
              activeTab === 'credentials' 
                ? 'bg-white text-slate-900 shadow-sm' 
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            Credentials & IDs
          </button>
          <button
            onClick={() => setActiveTab('arduino')}
            className={`flex-1 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${
              activeTab === 'arduino' 
                ? 'bg-white text-slate-900 shadow-sm' 
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            ESP32 / Arduino Code
          </button>
        </div>

        {/* Main scrollable body */}
        <div className="flex-1 overflow-y-auto space-y-6 pr-1 custom-scrollbar">
          {activeTab === 'credentials' ? (
            <div className="space-y-5 text-left">
              {/* Active patient detail */}
              <div className="bg-slate-50 border border-slate-100 p-5 rounded-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-teal-500/5 rounded-full blur-2xl pointer-events-none" />
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Active family member</span>
                  <span className="text-[8px] bg-teal-500/10 text-teal-600 font-bold px-2 py-0.5 rounded-full">Primary Sync</span>
                </div>
                <div className="text-base font-black text-slate-800 mb-4">{activePatient?.name || 'Loading profile...'}</div>

                <div>
                  <div className="text-[10px] uppercase font-black tracking-widest text-slate-400 mb-1.5 text-left">PATIENT ID (PASTE IN ARDUINO)</div>
                  <div className="flex items-center gap-2 bg-slate-900 text-white rounded-xl p-3 font-mono text-xs overflow-hidden">
                    <span className="flex-1 overflow-x-auto whitespace-nowrap scrollbar-none font-bold text-teal-400 select-all leading-normal">{selectedPatientId}</span>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(selectedPatientId);
                        simulateAction("Copied ID", `Patient ID copied`, "success");
                      }}
                      className="p-1.5 px-3 bg-white/10 hover:bg-white/20 text-white rounded-lg text-[9px] font-black tracking-widest uppercase transition-all flex items-center gap-1 shrink-0"
                    >
                      <Copy size={10} /> Copy
                    </button>
                  </div>
                </div>
              </div>

              {/* Patient List */}
              <div className="bg-white border border-slate-100 p-5 rounded-3xl">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">All Family Members & IDs</h4>
                <div className="space-y-4 max-h-[160px] overflow-y-auto pr-1">
                  {patients.map(p => (
                    <div key={p.id} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-slate-800">{p.name}</span>
                          {p.id === selectedPatientId && (
                            <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5 select-all">{p.id}</div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {p.id !== selectedPatientId && (
                          <button
                            onClick={() => setSelectedPatientId(p.id)}
                            className="p-1 px-2.5 hover:bg-slate-100 text-slate-600 hover:text-slate-900 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all border border-slate-100"
                          >
                            Select
                          </button>
                        )}
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(p.id);
                            simulateAction("Copied", `Patient ID for ${p.name} copied`, "success");
                          }}
                          className="p-1 px-2.5 bg-slate-900 text-white hover:bg-teal-600 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-1"
                        >
                          <Copy size={10} /> Copy ID
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Owner UUID Info */}
              <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl flex items-center justify-between gap-4">
                <div className="text-left">
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Database Owner UID</span>
                  <div className="text-[11px] font-mono font-bold text-slate-600 mt-0.5 select-all truncate max-w-[220px]">{user?.uid || 'Not authenticated'}</div>
                </div>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(user?.uid || '');
                    simulateAction("Copied UID", "User Owner UID copied", "success");
                  }}
                  className="p-1 px-3 bg-white border border-slate-200 text-slate-600 hover:text-slate-900 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1 shrink-0 shadow-sm"
                >
                  <Copy size={10} /> Copy UID
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 text-left font-sans">
              <div className="text-slate-600 text-[11px] leading-relaxed font-semibold">
                Paste this config block directly at the top of your **C++ Arduino Sketch** for the smart medicine box (ESP32 / ESP8266 or similar microcontroller) to link the hardware to physical records.
              </div>

              <div className="relative">
                <textarea 
                  readOnly 
                  value={sampleArduinoCode}
                  className="w-full h-44 bg-slate-900 text-slate-300 rounded-2xl p-4 font-mono text-[9.5px] focus:outline-none resize-none select-all custom-scrollbar leading-relaxed"
                />
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(sampleArduinoCode);
                    simulateAction("Code Copied", "Arduino script configuration copied", "success");
                  }}
                  className="absolute bottom-3 right-3 p-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-[9px] font-black uppercase tracking-wider flex items-center gap-1 transition-all shadow-lg backdrop-blur-md"
                >
                  <Copy size={12} /> Copy Block
                </button>
              </div>

              <div className="bg-teal-50 border border-teal-100 p-4 rounded-2xl text-left">
                <h5 className="text-[10px] font-black text-teal-800 uppercase tracking-widest mb-1.5">How-To Sync</h5>
                <ol className="list-decimal list-inside text-[11px] text-slate-600 space-y-1.5 font-medium leading-normal">
                  <li>Configure the WiFi credentials to connect the physical hardware to internet.</li>
                  <li>Copy either the general **User UID** or the active **Patient ID** to route database listens to the box.</li>
                  <li>Your box will monitor the path <code className="font-mono bg-white px-1 py-0.5 rounded text-[10px]">users/{"{USER_UID}"}/patients/{"{PATIENT_ID}"}/schedules</code> inside Firebase Firestore database environment.</li>
                </ol>
              </div>
            </div>
          )}
        </div>

        {/* Sync Status Info Footer */}
        <div className="mt-6 pt-4 border-t border-slate-100 shrink-0 text-left">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">App Cloud Sync Server</span>
            </div>
            <span className="text-[10px] font-mono font-bold text-slate-600 select-all truncate max-w-[200px]">{window.location.host}</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// Sub-components for better organization
function VitalsView({ data, onAdd }: { data: VitalEntry[], onAdd: (vital: any) => Promise<void> }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newVital, setNewVital] = useState<{
    type: VitalEntry['type'];
    value: string;
    value2: string;
    unit: string;
  }>({
    type: 'blood_pressure',
    value: '',
    value2: '',
    unit: 'mmHg'
  });

  const bpData = [...data].reverse().filter(v => v.type === 'blood_pressure').map(v => ({
    time: format(new Date(v.timestamp), 'MMM d'),
    systolic: v.value,
    diastolic: v.value2
  }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onAdd({
      ...newVital,
      value: parseFloat(newVital.value),
      value2: newVital.value2 ? parseFloat(newVital.value2) : undefined
    });
    setIsModalOpen(false);
    setNewVital({ type: 'blood_pressure', value: '', value2: '', unit: 'mmHg' });
  };

  const getLatest = (type: VitalEntry['type']) => {
    return data.find(v => v.type === type);
  }

  const latestBP = getLatest('blood_pressure');
  const latestSugar = getLatest('blood_sugar');
  const latestHR = getLatest('heart_rate');

  const getVitalVisuals = (type: VitalEntry['type'], v1: number, v2?: number) => {
    const status = getVitalStatus(type, v1, v2);
    const icon = status.severity === 'alert' ? <ShieldAlert size={10} /> : status.severity === 'warning' ? <AlertCircle size={10} /> : <CheckCircle2 size={10} />;
    return { ...status, icon };
  };

  const bpStatus = latestBP ? getVitalVisuals('blood_pressure', latestBP.value, latestBP.value2) : null;
  const sugarStatus = latestSugar ? getVitalVisuals('blood_sugar', latestSugar.value) : null;
  const hrStatus = latestHR ? getVitalVisuals('heart_rate', latestHR.value) : null;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 md:space-y-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h3 className="text-3xl md:text-4xl font-black text-slate-800 tracking-tighter">Health Vitals</h3>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="w-full sm:w-auto bg-slate-900 text-white px-6 md:px-8 py-3.5 md:py-4 rounded-xl md:rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-[0.2em] shadow-xl shadow-slate-900/20 flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all"
        >
          <Plus size={16} /> Log New Reading
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        <div className="bg-white p-6 md:p-8 rounded-[32px] md:rounded-[40px] border border-white shadow-sm overflow-hidden relative">
          <Heart className="w-5 h-5 md:w-6 md:h-6 text-red-500 mb-3 md:mb-4" />
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Blood Pressure</h3>
          <p className={`text-2xl md:text-3xl font-black ${bpStatus?.color || 'text-slate-800'}`}>
            {latestBP ? `${latestBP.value}/${latestBP.value2}` : '--/--'} 
            <span className="text-xs md:text-sm font-bold text-slate-400 ml-1">mmHg</span>
          </p>
          {bpStatus && (
            <div className={`mt-3 md:mt-4 text-[9px] md:text-[10px] font-black ${bpStatus.color} uppercase tracking-widest flex items-center gap-1.5`}>
              {bpStatus.icon} {bpStatus.label}
            </div>
          )}
        </div>
        <div className="bg-white p-6 md:p-8 rounded-[32px] md:rounded-[40px] border border-white shadow-sm">
          <Activity className="w-5 h-5 md:w-6 md:h-6 text-orange-500 mb-3 md:mb-4" />
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Blood Sugar</h3>
          <p className={`text-2xl md:text-3xl font-black ${sugarStatus?.color || 'text-slate-800'}`}>
            {latestSugar?.value || '--'} 
            <span className="text-xs md:text-sm font-bold text-slate-400 ml-1">mg/dL</span>
          </p>
          {sugarStatus ? (
            <div className={`mt-3 md:mt-4 text-[9px] md:text-[10px] font-black ${sugarStatus.color} uppercase tracking-widest flex items-center gap-1.5`}>
              {sugarStatus.icon} {sugarStatus.label}
            </div>
          ) : (
             <div className="mt-4 text-[10px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-1.5">
               <AlertCircle size={10} /> No Data
             </div>
          )}
        </div>
        <div className="bg-white p-6 md:p-8 rounded-[32px] md:rounded-[40px] border border-white shadow-sm">
          <Activity className="w-5 h-5 md:w-6 md:h-6 text-teal-500 mb-3 md:mb-4" />
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Heart Rate</h3>
          <p className={`text-2xl md:text-3xl font-black ${hrStatus?.color || 'text-slate-800'}`}>
            {latestHR?.value || '--'} 
            <span className="text-xs md:text-sm font-bold text-slate-400 ml-1">bpm</span>
          </p>
          {hrStatus && (
            <div className={`mt-3 md:mt-4 text-[9px] md:text-[10px] font-black ${hrStatus.color} uppercase tracking-widest flex items-center gap-1.5`}>
              {hrStatus.icon} {hrStatus.label}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white p-6 md:p-10 rounded-[32px] md:rounded-[40px] border border-white shadow-sm">
        <div className="flex items-center justify-between mb-6 md:mb-10">
          <h3 className="text-xl md:text-2xl font-black text-slate-800 flex items-center gap-3">
             <LayoutDashboard className="text-teal-500 w-5 h-5 md:w-6 md:h-6" /> <span className="truncate">Vital Trends</span>
          </h3>
        </div>
        <div className="h-[300px] md:h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={bpData}>
              <defs>
                <linearGradient id="colorSys" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold', fill: '#94a3b8' }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold', fill: '#94a3b8' }} />
              <Tooltip 
                contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 20px 40px rgba(0,0,0,0.1)', fontWeight: 'bold' }} 
              />
              <Area type="monotone" dataKey="systolic" stroke="#ef4444" strokeWidth={4} fillOpacity={1} fill="url(#colorSys)" />
              <Area type="monotone" dataKey="diastolic" stroke="#3b82f6" strokeWidth={4} fillOpacity={0} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Manual Entry Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               onClick={() => setIsModalOpen(false)}
               className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" 
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-md rounded-[40px] shadow-2xl border border-white p-8 relative z-10"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-black tracking-tight text-slate-800">Log Vital</h3>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                  <ChevronRight size={20} className="rotate-90" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Reading Type</label>
                  <select 
                    value={newVital.type}
                    onChange={(e) => {
                      const type = e.target.value as VitalEntry['type'];
                      setNewVital(prev => ({ 
                        ...prev, 
                        type, 
                        unit: type === 'blood_pressure' ? 'mmHg' : type === 'blood_sugar' ? 'mg/dL' : type === 'heart_rate' ? 'bpm' : 'kg' 
                      }))
                    }}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 px-5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  >
                    <option value="blood_pressure">Blood Pressure</option>
                    <option value="blood_sugar">Blood Sugar</option>
                    <option value="heart_rate">Heart Rate</option>
                    <option value="weight">Weight</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">
                       {newVital.type === 'blood_pressure' ? 'Systolic' : 'Value'}
                    </label>
                    <input 
                      type="number" 
                      required
                      placeholder="e.g 120"
                      value={newVital.value}
                      onChange={(e) => setNewVital(prev => ({ ...prev, value: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 px-5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    />
                  </div>
                  {newVital.type === 'blood_pressure' && (
                    <div>
                      <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Diastolic</label>
                      <input 
                        type="number" 
                        required
                        placeholder="e.g 80"
                        value={newVital.value2}
                        onChange={(e) => setNewVital(prev => ({ ...prev, value2: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 px-5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                      />
                    </div>
                  )}
                </div>

                <button 
                  type="submit"
                   className="w-full bg-teal-600 text-white py-5 rounded-[24px] font-black text-sm uppercase tracking-[0.2em] shadow-xl shadow-teal-600/20 hover:scale-[1.02] active:scale-95 transition-all mt-4"
                >
                  Save Reading
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ContactsView({ data, onAdd, onRemove, simulateAction }: { data: Contact[], onAdd: (c: any) => Promise<void>, onRemove: (id: string) => Promise<void>, simulateAction: any }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newContact, setNewContact] = useState({
    name: "",
    relation: "",
    phone: "",
    type: "family" as Contact['type']
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onAdd(newContact);
    setIsModalOpen(false);
    setNewContact({ name: "", relation: "", phone: "", type: "family" });
  };

  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-6 md:space-y-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h3 className="text-3xl md:text-4xl font-black text-slate-800 tracking-tighter">Care Circle</h3>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="w-full sm:w-auto bg-slate-900 text-white px-6 md:px-8 py-3.5 md:py-4 rounded-xl md:rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-widest shadow-xl shadow-slate-900/20 flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all"
        >
          <Plus size={16} /> Add New Contact
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        <AnimatePresence>
          {data.map((contact) => (
            <motion.div 
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              whileHover={{ y: -5 }}
              key={contact.id} 
              className="bg-white p-6 md:p-8 rounded-[32px] md:rounded-[40px] border border-white shadow-sm flex flex-col justify-between relative group"
            >
              <button 
                onClick={() => onRemove(contact.id)}
                className="absolute top-4 right-4 p-2 bg-red-50 text-red-500 rounded-xl opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500 hover:text-white"
                title="Remove Contact"
              >
                <Plus size={16} className="rotate-45" />
              </button>

              <div>
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 shadow-sm ${
                  contact.type === 'doctor' ? 'bg-blue-50 text-blue-500' :
                  contact.type === 'emergency' ? 'bg-red-50 text-red-500' :
                  'bg-green-50 text-green-500'
                }`}>
                  {contact.type === 'doctor' ? <User size={28} /> : 
                   contact.type === 'emergency' ? <ShieldAlert size={28} /> : 
                   <Phone size={28} />}
                </div>
                <h4 className="text-2xl font-black text-slate-800 mb-1">{contact.name}</h4>
                <p className="text-sm font-bold text-slate-400 mb-6 uppercase tracking-widest">{contact.relation}</p>
              </div>
              
              <button 
                onClick={() => simulateAction("Contact Pinged", `Alerting ${contact.name} (${contact.relation})`, "info")}
                className="w-full bg-slate-50 border border-slate-100 py-4 rounded-2xl flex items-center justify-center gap-3 font-black text-slate-600 hover:bg-slate-900 hover:text-white transition-all group/btn"
              >
                <Phone size={18} className="group-hover/btn:animate-bounce" />
                {contact.phone}
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Add Contact Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               onClick={() => setIsModalOpen(false)}
               className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" 
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-md rounded-[32px] md:rounded-[40px] shadow-2xl border border-white p-8 md:p-10 relative z-10"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-black tracking-tight text-slate-800">New Care Contact</h3>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                  <ChevronRight size={20} className="rotate-90" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Full Name</label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. Dr. Jane Smith"
                    value={newContact.name}
                    onChange={(e) => setNewContact(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 px-5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Relationship / Role</label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. Cardiologist or Daughter"
                    value={newContact.relation}
                    onChange={(e) => setNewContact(prev => ({ ...prev, relation: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 px-5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Phone Number</label>
                  <input 
                    type="tel" 
                    required
                    placeholder="+1 (555) 000-0000"
                    value={newContact.phone}
                    onChange={(e) => setNewContact(prev => ({ ...prev, phone: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 px-5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Contact Type</label>
                  <div className="grid grid-cols-3 gap-3">
                    {(['family', 'doctor', 'emergency'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setNewContact(prev => ({ ...prev, type: t }))}
                        className={`py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                          newContact.type === t 
                            ? 'bg-slate-900 text-white border-slate-900 shadow-lg' 
                            : 'bg-white text-slate-400 border-slate-100 hover:border-slate-200'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <button 
                  type="submit"
                   className="w-full bg-teal-600 text-white py-5 rounded-[24px] font-black text-sm uppercase tracking-[0.2em] shadow-xl shadow-teal-600/20 hover:scale-[1.02] active:scale-95 transition-all mt-4"
                >
                  Confirm Addition
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ReportsView({ schedules, vitals, simulateAction, onDownload }: { schedules: ScheduleItem[], vitals: VitalEntry[], simulateAction: any, onDownload: () => void }) {
  const adherence = (schedules.filter(s => s.status === 'taken').length / schedules.length) * 100 || 0;
  
  const handleShareApp = async () => {
    const directUrl = "https://ais-pre-nvw3ppmastrrebzeb4u2wa-640743221145.asia-southeast1.run.app";
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Medimate Health Portal",
          text: "Live medication adherence and health vitals monitoring.",
          url: directUrl
        });
        simulateAction("Portal Shared", "Shared link via system dialog", "success");
      } else {
        await navigator.clipboard.writeText(directUrl);
        simulateAction("Link Copied", "Direct app URL copied to clipboard", "success");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const getLatest = (type: VitalEntry['type']) => vitals.find(v => v.type === type);
  const latestBP = getLatest('blood_pressure');
  const latestSugar = getLatest('blood_sugar');
  const latestHR = getLatest('heart_rate');
  
  const bpInsight = latestBP 
    ? (latestBP.value >= 140 || (latestBP.value2 && latestBP.value2 >= 90)) 
      ? "Your blood pressure is currently elevated. Please continue monitoring and follow your prescribed regimen strictly."
      : "Your blood pressure has stabilized within the optimal range."
    : "No blood pressure data recorded yet.";

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8 md:space-y-12 max-w-5xl mx-auto pb-20">
      <div className="bg-white rounded-[32px] md:rounded-[48px] p-6 md:p-12 shadow-2xl shadow-slate-200/50 relative overflow-hidden border border-slate-100">
        <div className="absolute top-0 right-0 w-96 h-96 bg-slate-50/50 rounded-full blur-3xl -z-0 translate-x-1/2 -translate-y-1/2" />
        
        <div className="relative z-10">
          {/* Mock Document Header */}
          <div className="flex flex-col md:flex-row items-start justify-between border-b pb-6 md:pb-10 mb-8 md:mb-12 gap-6 md:gap-0">
            <div className="flex items-center gap-4 md:gap-6">
              <div className="w-16 h-16 md:w-20 md:h-20 bg-[#84cc16] rounded-2xl md:rounded-[24px] flex items-center justify-center text-white shadow-xl shadow-lime-500/20">
                <Bell className="w-8 h-8 md:w-10 md:h-10" strokeWidth={2.5} fill="white" />
              </div>
              <div>
                <div className="text-2xl md:text-4xl font-black text-slate-900 tracking-tighter flex items-center">
                  MED<span className="text-[#84cc16] mx-[1px]">I</span>MATE
                </div>
                <div className="text-xl md:text-3xl font-black text-slate-400 tracking-[-0.02em] leading-tight">
                  HEALTH REPORT
                </div>
              </div>
            </div>
            <div className="text-left md:text-right">
              <div className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Authenticated Document</div>
              <div className="text-sm font-bold text-slate-900">{format(new Date(), 'PPP')}</div>
              <div className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">ID: MED-992-UX</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 md:gap-12">
            <div className="lg:col-span-2 space-y-8 md:space-y-10">
              <div className="space-y-3 md:space-y-4">
                <h4 className="text-[8px] md:text-[10px] font-black text-[#84cc16] uppercase tracking-[0.3em] bg-[#84cc16]/10 w-fit px-3 py-1 rounded-full">Medication Adherence Summary</h4>
                <div className="flex items-baseline gap-4">
                  <h3 className="text-5xl md:text-6xl font-black tracking-tighter text-slate-900">
                    {Math.round(adherence)}%
                  </h3>
                  <span className="text-xs md:text-sm font-bold text-slate-400">System Accuracy</span>
                </div>
                <p className="text-base md:text-lg text-slate-500 leading-relaxed font-medium">
                  {bpInsight} Focus on evening consistency to improve overall therapeutic response.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4 md:gap-8 border-t pt-8 md:pt-10">
                <div className="space-y-1">
                  <span className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">Taken</span>
                  <p className="text-xl md:text-2xl font-black text-slate-800">{schedules.filter(s => s.status === 'taken').length}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">Missed</span>
                  <p className="text-xl md:text-2xl font-black text-slate-800">{schedules.filter(s => s.status === 'missed').length}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest text-[#84cc16]">Verification</span>
                  <p className="text-xl md:text-2xl font-black text-[#84cc16]">99.2%</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 rounded-[24px] md:rounded-[32px] p-6 md:p-10 space-y-6 md:space-y-8">
              <h4 className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Vital Sign Analysis</h4>
              
              <div className="space-y-4 md:space-y-6">
                {[
                  { label: "Blood Pressure", val: latestBP ? `${latestBP.value}/${latestBP.value2}` : '--', unit: "mmHg", icon: <Heart className="text-red-500" size={16} /> },
                  { label: "Blood Sugar", val: latestSugar?.value || '--', unit: "mg/dL", icon: <Activity className="text-orange-500" size={16} /> },
                  { label: "Heart Rate", val: latestHR?.value || '--', unit: "bpm", icon: <Activity className="text-teal-500" size={16} /> }
                ].map((v, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-slate-200 pb-3 md:pb-4 last:border-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      {v.icon}
                      <span className="text-[10px] md:text-xs font-bold text-slate-500">{v.label}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-xs md:text-sm font-black text-slate-800">{v.val}</div>
                      <div className="text-[7px] md:text-[8px] font-bold text-slate-400 uppercase tracking-widest">{v.unit}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-2 md:pt-4">
                <button 
                  onClick={onDownload}
                  className="w-full bg-slate-900 text-white py-4 md:py-5 rounded-xl md:rounded-[24px] font-black text-[10px] md:text-xs uppercase tracking-[0.2em] shadow-xl shadow-slate-900/20 hover:scale-[1.02] active:scale-95 transition-all"
                >
                  Download Report
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
        <div className="bg-white p-8 md:p-10 rounded-[32px] md:rounded-[48px] border border-slate-100 shadow-sm relative overflow-hidden group">
           <div className="absolute top-0 left-0 w-1.5 md:w-2 h-full bg-[#84cc16]" />
           <h4 className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-6 md:mb-8">Clinical Intake History</h4>
           <div className="space-y-5 md:space-y-6">
              {[
                { date: "May 15", time: "08:12", event: "Morning BP verified (124/82)", status: "Good" },
                { date: "May 14", time: "22:04", event: "Late night sugar log (142 mg/dL)", status: "High" },
                { date: "May 13", time: "09:45", event: "Medication refill detected", status: "System" }
              ].map((entry, i) => (
                <div key={i} className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-black text-slate-800">{entry.event}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">{entry.date} • {entry.time}</p>
                  </div>
                  <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md ${
                    entry.status === 'Good' ? 'bg-green-50 text-green-600' : 
                    entry.status === 'High' ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-400'
                  }`}>
                    {entry.status}
                  </span>
                </div>
              ))}
           </div>
        </div>
        
        <div className="bg-slate-900 rounded-[48px] p-10 text-white shadow-2xl relative overflow-hidden flex flex-col justify-between group">
           <div className="absolute inset-0 bg-linear-to-br from-teal-500/10 to-transparent pointer-events-none" />
           <div>
             <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center mb-8">
                <ShieldAlert size={24} className="text-[#84cc16]" />
             </div>
             <h4 className="text-xl font-black tracking-tight mb-2">Caregiver Connect</h4>
             <p className="text-white/50 text-sm font-medium leading-relaxed">
               Direct encrypted channel to medical facility (ABPS Medical Wing). Priority status active.
             </p>
           </div>
           
           <div className="flex flex-col gap-4 mt-8">
             <button 
               onClick={handleShareApp}
               className="w-full bg-white text-slate-900 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl flex items-center justify-center gap-2 hover:scale-105 transition-all"
             >
               <Share2 size={16} /> Share Direct App URL
             </button>
             <button className="w-full bg-[#84cc16] text-slate-900 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-lime-500/20 hover:scale-105 transition-all">
               Notify Medical Team
             </button>
           </div>
        </div>
      </div>
    </motion.div>
  );
}
