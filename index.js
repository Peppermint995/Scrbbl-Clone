import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  onSnapshot, 
  updateDoc, 
  arrayUnion, 
  getDoc,
  collection,
  query,
  getDocs,
  serverTimestamp
} from 'firebase/firestore';
import { 
  getAuth, 
  signInAnonymously, 
  signInWithCustomToken, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  Pencil, 
  Eraser, 
  Trash2, 
  Send, 
  Users, 
  Globe, 
  Lock, 
  PlusCircle, 
  Hash,
  Copy,
  Check,
  LogOut,
  Circle
} from 'lucide-react';

// --- Firebase Configuration ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'skribbl-rooms-v2';

// --- Constants ---
const COLORS = [
  '#000000', '#ffffff', '#4b4b4b', '#c1c1c1',
  '#ee1b24', '#ff7e26', '#fef200', '#22b14c', 
  '#00a2e8', '#3f48cc', '#a349a4', '#b97a57',
  '#ffaec9', '#ffca18', '#efe4b0', '#b5e61d',
  '#99d9ea', '#7092be', '#c8bfe7'
];
const AVATAR_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b', '#06b6d4'];
const AVATAR_ICONS = ['🐱', '🐶', '🦊', '🐨', '🦁', '🐸', '🦄', '🐼', '🤖', '👾', '👻', '🤡'];
const WORDS = ['Apple', 'Banana', 'Car', 'Dog', 'Elephant', 'Fire', 'Guitar', 'House', 'Ice Cream', 'Jungle', 'Kangaroo', 'Lamp', 'Mountain', 'Notebook', 'Ocean', 'Piano', 'Queen', 'Robot', 'Sun', 'Tree', 'Umbrella', 'Violin', 'Whale', 'Xylophone', 'Yacht', 'Zebra'];

export default function App() {
  const [user, setUser] = useState(null);
  const [room, setRoom] = useState(null);
  const [currentRoomId, setCurrentRoomId] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [avatarIcon, setAvatarIcon] = useState(AVATAR_ICONS[0]);
  const [isJoined, setIsJoined] = useState(false);
  const [messages, setMessages] = useState([]);
  const [players, setPlayers] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [privateRoomCode, setPrivateRoomCode] = useState('');
  const [view, setView] = useState('lobby');
  const [copied, setCopied] = useState(false);
  
  const canvasRef = useRef(null);
  const contextRef = useRef(null);
  const [currentColor, setCurrentColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(5);
  const [isErasing, setIsErasing] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);

  // --- Auth Setup ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth error:", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- Room Sync ---
  useEffect(() => {
    if (!user || !isJoined || !currentRoomId) return;

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'game_rooms', currentRoomId);
    
    const unsubscribe = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setRoom(data);
        setPlayers(data.players || []);
        setMessages(data.messages || []);
        if (data.lines) redrawCanvas(data.lines);
      } else {
        setIsJoined(false);
        setView('lobby');
      }
    }, (err) => console.error("Room sync error:", err));

    return () => unsubscribe();
  }, [user, isJoined, currentRoomId]);

  // --- Canvas Setup ---
  useEffect(() => {
    if (view !== 'game') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const container = canvas.parentElement;
      if (!container) return;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      if (room?.lines) redrawCanvas(room.lines);
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    contextRef.current = ctx;

    return () => window.removeEventListener('resize', resizeCanvas);
  }, [view, room?.lines]);

  const redrawCanvas = (lines) => {
    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    lines.forEach(line => {
      if (!line.points || line.points.length === 0) return;
      ctx.beginPath();
      ctx.strokeStyle = line.color;
      ctx.lineWidth = line.size;
      line.points.forEach((p, i) => {
        const x = p.x * canvas.width;
        const y = p.y * canvas.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  };

  const clearCanvas = async () => {
    if (!room?.currentDrawer || room.currentDrawer !== user?.uid || !currentRoomId) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'game_rooms', currentRoomId);
    try {
      await updateDoc(roomRef, { lines: [] });
    } catch (err) {
      console.error("Clear canvas error:", err);
    }
  };

  const joinOrCreateRoom = async (roomId, isPrivate = false) => {
    if (!playerName.trim() || !user) return;
    
    const cleanRoomId = roomId.trim().toUpperCase();
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'game_rooms', cleanRoomId);
    
    const playerData = { 
      id: user.uid, 
      name: playerName, 
      score: 0, 
      avatarColor, 
      avatarIcon 
    };

    try {
      const snap = await getDoc(roomRef);
      if (!snap.exists()) {
        await setDoc(roomRef, {
          id: cleanRoomId,
          isPrivate: isPrivate,
          players: [playerData],
          currentDrawer: user.uid,
          currentWord: WORDS[Math.floor(Math.random() * WORDS.length)].toLowerCase(),
          lines: [],
          messages: [],
          createdAt: Date.now()
        });
      } else {
        const data = snap.data();
        const existingPlayers = data.players || [];
        if (!existingPlayers.find(p => p.id === user.uid)) {
          await updateDoc(roomRef, {
            players: arrayUnion(playerData)
          });
        }
      }
      
      setCurrentRoomId(cleanRoomId);
      setIsJoined(true);
      setView('game');
    } catch (err) {
      console.error("Critical Room Error:", err);
    }
  };

  const quickPlay = async () => {
    if (!user) return;
    try {
      const roomsCol = collection(db, 'artifacts', appId, 'public', 'data', 'game_rooms');
      const snap = await getDocs(roomsCol);
      let targetRoomId = null;

      snap.forEach(doc => {
        const data = doc.data();
        if (!data.isPrivate && (data.players?.length || 0) < 8) {
          targetRoomId = doc.id;
        }
      });

      if (!targetRoomId) {
        targetRoomId = `PUB-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      }
      joinOrCreateRoom(targetRoomId, false);
    } catch (err) {
      console.error("Quick play search failed:", err);
    }
  };

  const isDrawer = room?.currentDrawer === user?.uid;

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = (e.touches ? e.touches[0].clientX : e.clientX);
    const clientY = (e.touches ? e.touches[0].clientY : e.clientY);
    return {
      x: (clientX - rect.left) / canvas.width,
      y: (clientY - rect.top) / canvas.height
    };
  };

  const startDrawing = (e) => {
    if (!isDrawer || !isJoined) return;
    const { x, y } = getCoordinates(e);
    setIsDrawing(true);
    
    const newLine = {
      color: isErasing ? '#ffffff' : currentColor,
      size: brushSize,
      points: [{ x, y }]
    };
    
    setRoom(prev => ({
      ...prev,
      lines: [...(prev?.lines || []), newLine]
    }));
  };

  const draw = (e) => {
    if (!isDrawing || !isDrawer) return;
    const { x, y } = getCoordinates(e);
    
    setRoom(prev => {
      const lines = [...(prev?.lines || [])];
      if (lines.length === 0) return prev;
      const lastLine = { ...lines[lines.length - 1] };
      lastLine.points = [...lastLine.points, { x, y }];
      lines[lines.length - 1] = lastLine;
      redrawCanvas(lines);
      return { ...prev, lines };
    });
  };

  const stopDrawing = async () => {
    if (!isDrawing || !isDrawer) return;
    setIsDrawing(false);
    
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'game_rooms', currentRoomId);
    try {
      await updateDoc(roomRef, { lines: room.lines });
    } catch (err) {
      console.error("Sync drawing error:", err);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || !user || !room || !currentRoomId) return;

    const msg = inputMessage.trim().toLowerCase();
    const isCorrect = msg === room.currentWord && !isDrawer;
    
    const newMessage = {
      sender: playerName || 'Anonymous',
      senderId: user.uid,
      text: isCorrect ? 'guessed the word!' : inputMessage,
      system: isCorrect,
      avatarIcon: avatarIcon,
      timestamp: Date.now()
    };

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'game_rooms', currentRoomId);
    
    try {
      let updates = {
        messages: arrayUnion(newMessage)
      };

      if (isCorrect) {
        const updatedPlayers = players.map(p => 
          p.id === user.uid ? { ...p, score: (p.score || 0) + 10 } : p
        );
        updates.players = updatedPlayers;
        
        const nextIdx = (players.findIndex(p => p.id === room.currentDrawer) + 1) % players.length;
        updates.currentDrawer = players[nextIdx].id;
        updates.currentWord = WORDS[Math.floor(Math.random() * WORDS.length)].toLowerCase();
        updates.lines = [];
      }

      await updateDoc(roomRef, updates);
      setInputMessage('');
    } catch (err) {
      console.error("Message error:", err);
    }
  };

  const copyRoomCode = () => {
    try {
      navigator.clipboard.writeText(currentRoomId);
    } catch (e) {
      const el = document.createElement('textarea');
      el.value = currentRoomId;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (view === 'lobby') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-2xl overflow-hidden animate-in zoom-in duration-300">
          <div className="text-center mb-8">
            <h1 className="text-6xl font-black text-blue-600 italic tracking-tighter drop-shadow-sm">skribbl.io</h1>
            <p className="text-slate-400 font-bold uppercase text-[10px] tracking-[0.3em] mt-2">v2.1 Tools Update</p>
          </div>
          
          <div className="flex flex-col md:flex-row gap-8">
            <div className="flex-1 flex flex-col items-center border-b md:border-b-0 md:border-r border-slate-100 pb-8 md:pb-0 md:pr-8">
              <div 
                className="w-40 h-40 rounded-[2.5rem] flex items-center justify-center text-7xl shadow-xl mb-6 transform hover:scale-105 transition-transform cursor-default"
                style={{ backgroundColor: avatarColor }}
              >
                {avatarIcon}
              </div>
              
              <input 
                type="text"
                placeholder="Name..."
                className="w-full px-5 py-4 border-2 border-slate-100 rounded-2xl focus:border-blue-500 outline-none font-bold text-center text-lg shadow-inner bg-slate-50"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                maxLength={12}
              />

              <div className="mt-6 w-full space-y-4">
                <div className="grid grid-cols-4 gap-2">
                  {AVATAR_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setAvatarColor(c)}
                      className={`h-8 rounded-lg transition-all ${avatarColor === c ? 'ring-4 ring-blue-500/30 scale-110' : 'opacity-40 hover:opacity-100'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="grid grid-cols-6 gap-2">
                  {AVATAR_ICONS.map(i => (
                    <button
                      key={i}
                      onClick={() => setAvatarIcon(i)}
                      className={`text-2xl p-1.5 rounded-xl transition-all ${avatarIcon === i ? 'bg-blue-50 ring-2 ring-blue-500 scale-110' : 'hover:bg-slate-50'}`}
                    >
                      {i}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex-1 flex flex-col justify-center space-y-4">
              <button 
                onClick={quickPlay}
                disabled={!playerName.trim()}
                className="group w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white p-6 rounded-2xl transition-all shadow-lg active:scale-95"
              >
                <div className="flex items-center justify-between">
                  <div className="text-left">
                    <p className="text-2xl font-black italic">QUICK PLAY</p>
                    <p className="text-blue-200 text-xs font-bold uppercase tracking-widest">Public Lobby</p>
                  </div>
                  <Globe className="w-8 h-8 opacity-50 group-hover:opacity-100" />
                </div>
              </button>

              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t-2 border-slate-100"></span></div>
                <div className="relative flex justify-center text-[10px] uppercase font-black text-slate-300 tracking-widest"><span className="bg-white px-3">Private Match</span></div>
              </div>

              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input 
                      type="text"
                      placeholder="CODE..."
                      className="w-full pl-10 pr-4 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-purple-500 outline-none font-mono font-bold uppercase tracking-widest text-center"
                      value={privateRoomCode}
                      onChange={(e) => setPrivateRoomCode(e.target.value.toUpperCase())}
                      maxLength={6}
                    />
                  </div>
                  <button 
                    onClick={() => {
                      const code = privateRoomCode.trim() || Math.random().toString(36).substring(2, 8).toUpperCase();
                      joinOrCreateRoom(code, true);
                    }}
                    disabled={!playerName.trim()}
                    className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-6 rounded-2xl transition-all shadow-lg active:scale-90 flex items-center justify-center"
                  >
                    <PlusCircle size={24} />
                  </button>
                </div>
                <p className="text-[9px] text-center text-slate-400 font-bold uppercase tracking-wider">Leave code blank to generate a new private room</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const sortedPlayers = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));

  return (
    <div className="h-screen bg-slate-100 flex flex-col md:flex-row overflow-hidden font-sans">
      <div className="w-full md:w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <h2 className="font-black italic text-slate-700 flex items-center gap-2">
            <Users size={18} className="text-blue-500" /> PLAYERS
          </h2>
          <button 
            onClick={() => { setView('lobby'); setIsJoined(false); }}
            className="text-slate-400 hover:text-red-500 transition-colors"
          >
            <LogOut size={16} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sortedPlayers.map((p) => (
            <div 
              key={p.id} 
              className={`flex items-center justify-between p-2.5 rounded-xl transition-all ${p.id === user?.uid ? 'bg-blue-50 ring-1 ring-blue-100 shadow-sm' : 'hover:bg-slate-50'}`}
            >
              <div className="flex items-center gap-3">
                <div 
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-xl shadow-sm shrink-0"
                  style={{ backgroundColor: p.avatarColor || '#cbd5e1' }}
                >
                  {p.avatarIcon || '👤'}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate text-slate-800 leading-tight">
                    {p.name} {p.id === user?.uid && " (You)"}
                  </p>
                  <p className="text-[10px] text-blue-600 font-black tracking-widest">{p.score || 0} PTS</p>
                </div>
              </div>
              {room?.currentDrawer === p.id && <Pencil size={12} className="text-blue-500 animate-pulse" />}
            </div>
          ))}
        </div>

        <div className="p-4 bg-slate-900 text-white flex items-center justify-between group">
           <div className="flex flex-col">
             <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Room ID</span>
             <span className="text-xs font-mono font-bold tracking-widest">{currentRoomId}</span>
           </div>
           <button onClick={copyRoomCode} className="hover:text-blue-400 transition-colors">
              {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
           </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col relative">
        <div className="bg-white border-b border-slate-200 flex flex-col z-10 shadow-sm">
          <div className="h-16 flex items-center justify-between px-6">
            <div className="flex items-center gap-4">
              <div className="bg-blue-600 text-white p-2 rounded-lg rotate-3">
                <Pencil size={20} />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase font-black tracking-[0.2em] leading-none mb-1">Guess This Word</p>
                <p className="font-mono text-xl font-black tracking-[0.4em] text-slate-800">
                  {isDrawer ? room?.currentWord?.toUpperCase() : (room?.currentWord || '').replace(/[a-z0-9]/gi, '_ ')}
                </p>
              </div>
            </div>
            
            {isDrawer && (
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setIsErasing(!isErasing)}
                  className={`p-2.5 rounded-xl transition-all ${isErasing ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  <Eraser size={20} />
                </button>
                <button onClick={clearCanvas} className="p-2.5 bg-red-50 text-red-500 rounded-xl hover:bg-red-100 shadow-sm">
                  <Trash2 size={20} />
                </button>
              </div>
            )}
          </div>

          {isDrawer && (
            <div className="h-20 bg-slate-50 border-t border-slate-100 flex items-center px-6 gap-6 overflow-x-auto">
              <div className="flex flex-col shrink-0 gap-1 min-w-[120px]">
                <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase">
                  <span>Size</span>
                  <span>{brushSize}px</span>
                </div>
                <input 
                  type="range" 
                  min="2" 
                  max="40" 
                  value={brushSize} 
                  onChange={(e) => setBrushSize(parseInt(e.target.value))}
                  className="w-full accent-blue-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div className="h-10 w-[2px] bg-slate-200 shrink-0" />

              <div className="flex flex-wrap gap-1.5 py-2 min-w-0">
                {COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => { setCurrentColor(c); setIsErasing(false); }}
                    className={`w-7 h-7 rounded-full border-2 transition-all flex items-center justify-center ${currentColor === c && !isErasing ? 'scale-110 border-slate-900 ring-2 ring-blue-500/20 shadow-md' : 'border-transparent opacity-80 hover:opacity-100'}`}
                    style={{ backgroundColor: c }}
                  >
                    {currentColor === c && !isErasing && <div className={`w-1 h-1 rounded-full ${c === '#ffffff' ? 'bg-black' : 'bg-white'}`} />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 bg-white relative cursor-crosshair">
          <canvas
            ref={canvasRef}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseOut={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
            className="w-full h-full touch-none"
          />
          
          {!isDrawer && (
            <div className="absolute inset-0 bg-slate-900/5 pointer-events-none flex items-center justify-center">
              <div className="bg-white/95 backdrop-blur-sm px-6 py-3 rounded-2xl border border-white/50 shadow-xl flex items-center gap-3 text-slate-700 font-bold italic">
                <span className="animate-bounce">🎨</span> 
                {players.find(p => p.id === room?.currentDrawer)?.name || 'Player'} is drawing...
              </div>
            </div>
          )}

          {isDrawer && (
            <div 
              className="absolute pointer-events-none w-10 h-10 border-2 border-slate-300 rounded-full flex items-center justify-center bg-white/50 backdrop-blur-sm hidden md:flex"
              style={{ 
                left: '20px', 
                bottom: '20px',
                width: `${brushSize + 10}px`,
                height: `${brushSize + 10}px`,
                backgroundColor: isErasing ? '#ffffff' : currentColor
              }}
            />
          )}
        </div>
      </div>

      <div className="w-full md:w-80 bg-slate-50 border-l border-slate-200 flex flex-col shrink-0 h-64 md:h-full">
        <div className="p-4 border-b border-slate-200 bg-white">
          <h2 className="font-black italic flex items-center gap-2 text-slate-700 text-xs tracking-widest">
            <Send size={14} className="text-blue-500" /> FEED
          </h2>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 flex flex-col-reverse">
          <div className="space-y-3">
            {messages.slice(-50).map((m, i) => (
              <div 
                key={i} 
                className={`text-sm flex gap-3 animate-in slide-in-from-bottom-1 duration-200 ${m.system ? 'bg-green-500/10 text-green-700 font-bold p-3 rounded-xl border border-green-500/10' : ''}`}
              >
                {!m.system && <span className="text-xl shrink-0">{m.avatarIcon || '💬'}</span>}
                <div className="min-w-0">
                  {!m.system && <p className="font-black text-[9px] text-slate-400 uppercase tracking-tighter mb-0.5">{m.sender}</p>}
                  <p className={`${m.system ? 'text-center w-full italic' : 'text-slate-700 font-medium'} leading-tight break-words`}>
                    {typeof m.text === 'string' ? m.text : '...'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={handleSendMessage} className="p-4 bg-white border-t border-slate-200 flex gap-2">
          <input 
            type="text"
            disabled={isDrawer}
            placeholder={isDrawer ? "You are drawing..." : "Type your guess..."}
            className="flex-1 px-4 py-3 bg-slate-100 border-none rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50 font-bold placeholder:text-slate-400"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
          />
          <button 
            type="submit"
            disabled={isDrawer || !inputMessage.trim()}
            className="p-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 disabled:opacity-50 shadow-lg active:scale-90"
          >
            <Send size={20} />
          </button>
        </form>
      </div>
    </div>
  );
}
