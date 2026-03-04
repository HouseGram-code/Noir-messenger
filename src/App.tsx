/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, FC, ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, User, Ghost, Settings, ChevronLeft, Send, Edit2, Save, X, Bot, Phone, Video, Mic, MicOff, VideoOff, PhoneOff, Camera, Info, HelpCircle, Plus, Smile, Paperclip, MoreVertical, CheckCircle } from 'lucide-react';
import EmojiPicker from 'emoji-picker-react';
import { auth, db, storage } from './lib/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile as updateAuthProfile } from 'firebase/auth';
import { doc, setDoc, getDoc, collection, query, where, getDocs, updateDoc, onSnapshot, addDoc, orderBy, serverTimestamp, Timestamp, limit } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import ImageBlobReduce from 'image-blob-reduce';
import localforage from 'localforage';
import { useAppStore, UserProfile, Theme } from './lib/store';
import { useTranslation } from './hooks/useTranslation';

// Types
// Theme and UserProfile are now imported from store

type Message = {
  id: string;
  text: string;
  sender: 'me' | 'other' | 'system';
  timestamp: Date;
};

type Chat = {
  id: string;
  name: string;
  avatar: string | null;
  lastMessage: string;
  unread: number;
  isBot?: boolean;
  isOfficial?: boolean;
  isOnline?: boolean;
  lastSeen?: Date;
  username: string;
  isGroup?: boolean;
  members?: string[];
  description?: string;
  owner?: string;
  inviteLink?: string;
};

type CallState = {
  isActive: boolean;
  type: 'voice' | 'video';
  status: 'calling' | 'connected' | 'ended' | 'failed';
  isMuted: boolean;
  isCameraOff: boolean;
  errorMessage?: string;
};

// Theme Config
const THEMES: Record<Theme, { primary: string, glow: string, border: string }> = {
  emerald: { primary: 'text-emerald-500', glow: 'shadow-[0_0_8px_rgba(16,185,129,0.5)]', border: 'focus:border-emerald-500/50' },
  blue: { primary: 'text-blue-500', glow: 'shadow-[0_0_8px_rgba(59,130,246,0.5)]', border: 'focus:border-blue-500/50' },
  purple: { primary: 'text-purple-500', glow: 'shadow-[0_0_8px_rgba(168,85,247,0.5)]', border: 'focus:border-purple-500/50' },
  rose: { primary: 'text-rose-500', glow: 'shadow-[0_0_8px_rgba(244,63,94,0.5)]', border: 'focus:border-rose-500/50' },
  amber: { primary: 'text-amber-500', glow: 'shadow-[0_0_8px_rgba(245,158,11,0.5)]', border: 'focus:border-amber-500/50' },
};

const getSafeTheme = (theme?: string | null): Theme => {
  if (theme && Object.keys(THEMES).includes(theme)) {
    return theme as Theme;
  }
  return 'emerald';
};

// Mock Data
const INITIAL_CHATS: Chat[] = [];

// Components

const CallOverlay: FC<{ 
  chat: Chat; 
  callState: CallState; 
  onEndCall: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  theme: Theme;
}> = ({ chat, callState, onEndCall, onToggleMute, onToggleCamera, theme }) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const themeConfig = THEMES[getSafeTheme(theme)];
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Initialize ringtone
    ringtoneRef.current = new Audio('https://cdn.freesound.org/previews/337/337049_3232293-lq.mp3'); // Placeholder ringtone
    ringtoneRef.current.loop = true;

    if (callState.status === 'calling') {
      ringtoneRef.current.play().catch(e => console.log("Audio play failed:", e));
    } else {
      ringtoneRef.current.pause();
      ringtoneRef.current.currentTime = 0;
    }

    return () => {
      ringtoneRef.current?.pause();
      ringtoneRef.current = null;
    };
  }, [callState.status]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (callState.status === 'connected') {
      interval = setInterval(() => setDuration(d => d + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [callState.status]);

  useEffect(() => {
    if (callState.type === 'video' && !callState.isCameraOff && callState.status !== 'ended' && callState.status !== 'failed') {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
          setMediaError(null);
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
          }
        })
        .catch(err => {
          console.warn("Media access denied:", err);
          setMediaError("Camera access denied. Please enable permissions.");
        });
    } else {
      if (localVideoRef.current && localVideoRef.current.srcObject) {
        const tracks = (localVideoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
        localVideoRef.current.srcObject = null;
      }
    }
  }, [callState.type, callState.isCameraOff, callState.status]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusText = () => {
    switch (callState.status) {
      case 'calling': return 'Calling...';
      case 'connected': return formatDuration(duration);
      case 'failed': return 'Unfortunately, no answer.';
      case 'ended': return 'Call Ended';
      default: return '';
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: '100%' }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: '100%' }}
      className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-between py-12 px-6"
    >
      {/* Header Info */}
      <div className="flex flex-col items-center space-y-2 mt-8">
        <h2 className="text-3xl font-light text-white">{chat.name}</h2>
        <p className={`${themeConfig.primary} text-sm font-medium tracking-wide`}>
          {getStatusText()}
        </p>
        {(callState.errorMessage || mediaError) && (
           <p className="text-red-500 text-xs mt-2">{callState.errorMessage || mediaError}</p>
        )}
      </div>

      {/* Main Visual */}
      <div className="flex-1 flex items-center justify-center w-full relative">
        {callState.type === 'video' ? (
          <div className="w-full h-full max-h-[60vh] bg-zinc-900 rounded-3xl overflow-hidden relative border border-zinc-800">
            {/* Remote Video Placeholder */}
            <div className="absolute inset-0 flex items-center justify-center">
              <User className="w-24 h-24 text-zinc-700" />
            </div>
            
            {/* Local Video Preview */}
            {!callState.isCameraOff && (
              <div className="absolute bottom-4 right-4 w-32 h-48 bg-black rounded-xl overflow-hidden border border-zinc-700 shadow-2xl">
                <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
              </div>
            )}
          </div>
        ) : (
          <div className="relative">
            <div className="w-40 h-40 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center z-10 relative">
              {chat.avatar ? (
                <img src={chat.avatar} alt={chat.name} className="w-full h-full object-cover rounded-full" />
              ) : (
                <User className="w-16 h-16 text-zinc-600" />
              )}
            </div>
            {callState.status === 'calling' && (
              <>
                <motion.div 
                  animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className={`absolute inset-0 ${themeConfig.primary.replace('text-', 'bg-')}/20 rounded-full -z-10`}
                />
                <motion.div 
                  animate={{ scale: [1, 2, 1], opacity: [0.3, 0, 0.3] }}
                  transition={{ repeat: Infinity, duration: 2, delay: 0.5 }}
                  className={`absolute inset-0 ${themeConfig.primary.replace('text-', 'bg-')}/10 rounded-full -z-20`}
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-6 mb-8">
        {callState.status !== 'failed' && (
          <>
            <button 
              onClick={onToggleCamera}
              className={`p-4 rounded-full transition-all ${callState.isCameraOff ? 'bg-white text-black' : 'bg-zinc-800/50 text-white hover:bg-zinc-800'}`}
            >
              {callState.isCameraOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
            </button>
            
            <button 
              onClick={onToggleMute}
              className={`p-4 rounded-full transition-all ${callState.isMuted ? 'bg-white text-black' : 'bg-zinc-800/50 text-white hover:bg-zinc-800'}`}
            >
              {callState.isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>
          </>
        )}

        <button 
          onClick={onEndCall}
          className="p-4 rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors shadow-[0_0_20px_rgba(239,68,68,0.4)]"
        >
          <PhoneOff className="w-8 h-8" />
        </button>
      </div>
    </motion.div>
  );
};

const AuthScreen: FC = () => {
  const [step, setStep] = useState<'email' | 'password' | 'details'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [isLogin, setIsLogin] = useState(true); // Track if we are logging in or registering

  const handleEmailSubmit = () => {
    if (!email.includes('@')) {
      setError('Invalid email address');
      return;
    }
    setError('');
    setStep('password');
  };

  const handlePasswordSubmit = async () => {
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setError('');
    
    try {
      // Try to sign in
      await signInWithEmailAndPassword(auth, email, password);
      // If successful, onAuthStateChanged in App will handle the rest
    } catch (e: any) {
      if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
        // If user not found or invalid credential (could be new user), ask if they want to register
        // But for simplicity, if it fails, we assume they might want to register if they are new.
        // Let's explicitly switch to registration mode if login fails and they want to.
        setError('Invalid email or password. If you are new, please switch to Register.');
      } else {
        setError(e.message);
      }
    }
  };

  const handleRegisterStep = () => {
     setIsLogin(false);
     setStep('details');
  }

  const handleRegisterSubmit = async () => {
    if (!name.trim() || !username.trim()) {
      setError('Name and Username are required');
      return;
    }
    
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Create user profile in Firestore
      const newUserProfile: UserProfile = {
        uid: user.uid,
        name,
        username: username.toLowerCase().replace(/\s/g, '_'),
        bio: 'New to Noir.',
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}&backgroundColor=b6e3f4`,
        email: user.email || email,
        theme: 'emerald'
      };

      await setDoc(doc(db, "users", user.uid), newUserProfile);
      
      // Also update auth profile
      await updateAuthProfile(user, { displayName: name });

    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      className="flex flex-col items-center justify-center min-h-screen p-8 bg-black text-white"
    >
      <div className="mb-12 flex flex-col items-center">
        <Ghost className="w-16 h-16 text-white mb-4" />
        <h1 className="text-3xl font-light tracking-[0.2em] uppercase">Noir</h1>
      </div>

      <div className="w-full max-w-xs space-y-6">
        <AnimatePresence mode="wait">
          {step === 'email' ? (
            <motion.div 
              key="email"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <label className="text-xs text-zinc-500 uppercase tracking-wider ml-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleEmailSubmit()}
                  className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:border-emerald-500/50 focus:outline-none transition-colors"
                  placeholder="enter@your.email"
                  autoFocus
                />
              </div>
              <button 
                onClick={handleEmailSubmit}
                className="w-full bg-white text-black rounded-xl py-3 font-medium hover:bg-zinc-200 transition-colors"
              >
                Continue
              </button>
            </motion.div>
          ) : step === 'password' ? (
            <motion.div 
              key="password"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <label className="text-xs text-zinc-500 uppercase tracking-wider ml-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
                  className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:border-emerald-500/50 focus:outline-none transition-colors"
                  placeholder="••••••••"
                  autoFocus
                />
              </div>
              <button 
                onClick={handlePasswordSubmit}
                className="w-full bg-white text-black rounded-xl py-3 font-medium hover:bg-zinc-200 transition-colors"
              >
                Login
              </button>
               <button 
                onClick={handleRegisterStep}
                className="w-full text-zinc-500 text-sm hover:text-white transition-colors"
              >
                New here? Create Account
              </button>
              <button 
                onClick={() => setStep('email')}
                className="w-full text-zinc-500 text-sm hover:text-white transition-colors"
              >
                Back
              </button>
            </motion.div>
          ) : (
             <motion.div 
              key="details"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <label className="text-xs text-zinc-500 uppercase tracking-wider ml-1">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:border-emerald-500/50 focus:outline-none transition-colors"
                  placeholder="Your Name"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-zinc-500 uppercase tracking-wider ml-1">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:border-emerald-500/50 focus:outline-none transition-colors"
                  placeholder="username"
                />
              </div>
              <button 
                onClick={handleRegisterSubmit}
                className="w-full bg-white text-black rounded-xl py-3 font-medium hover:bg-zinc-200 transition-colors"
              >
                Create Account
              </button>
              <button 
                onClick={() => setStep('password')}
                className="w-full text-zinc-500 text-sm hover:text-white transition-colors"
              >
                Back to Login
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        {error && <p className="text-red-500 text-xs text-center mt-2">{error}</p>}
      </div>
    </motion.div>
  );
};

const ChatDetailScreen: FC<{ chat: Chat; onBack: () => void; theme: Theme; currentUser: UserProfile; db: any }> = ({ chat, onBack, theme, currentUser, db }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [callState, setCallState] = useState<CallState | null>(null);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showLeaveConfirmation, setShowLeaveConfirmation] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [activeTab, setActiveTab] = useState<'stickers' | 'emoji' | 'gifs'>('emoji');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [memberProfiles, setMemberProfiles] = useState<Record<string, any>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const themeConfig = THEMES[getSafeTheme(theme)];

  useEffect(() => {
    if (showGroupInfo && chat.isGroup && chat.members) {
      const fetchMemberProfiles = async () => {
        const profiles: Record<string, any> = {};
        for (const memberId of chat.members!) {
          const userDoc = await getDoc(doc(db, "users", memberId));
          if (userDoc.exists()) {
            profiles[memberId] = userDoc.data();
          }
        }
        setMemberProfiles(profiles);
      };
      fetchMemberProfiles();
    }
  }, [showGroupInfo, chat.isGroup, chat.members, db]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Listen for real-time messages
  useEffect(() => {
    if (!chat.id) return;

    const q = query(
      collection(db, "chats", chat.id, "messages"),
      orderBy("timestamp", "asc"),
      limit(100)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs: Message[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        msgs.push({
          id: doc.id,
          text: data.text,
          sender: data.senderId === currentUser.uid ? 'me' : 'other',
          timestamp: data.timestamp ? data.timestamp.toDate() : new Date()
        });
      });
      setMessages(msgs);
      scrollToBottom();
    });

    return () => unsubscribe();
  }, [chat.id, currentUser.uid]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!inputText.trim()) return;

    const text = inputText;
    setInputText(''); // Clear input immediately for better UX

    try {
      // Add message to subcollection
      await addDoc(collection(db, "chats", chat.id, "messages"), {
        text: text,
        senderId: currentUser.uid,
        timestamp: serverTimestamp()
      });

      // Update last message in chat document
      await updateDoc(doc(db, "chats", chat.id), {
        lastMessage: text,
        lastMessageTimestamp: serverTimestamp(),
        [`unread.${chat.username}`]: (chat.unread || 0) + 1 // Simple increment logic, can be refined
      });

    } catch (e) {
      console.error("Error sending message:", e);
      // Optionally restore input text if failed
    }
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const MAX_SIZE = 150 * 1024 * 1024; // 150 MB

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > MAX_SIZE) {
        alert(`File ${file.name} is too large. Max size is 150 MB.`);
        continue;
      }

      const storageRef = ref(storage, `chats/${chat.id}/${Date.now()}_${file.name}`);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on('state_changed', 
        (snapshot) => {},
        (error) => console.error(error),
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          await addDoc(collection(db, "chats", chat.id, "messages"), {
            text: `File: ${file.name}`,
            fileUrl: downloadURL,
            fileType: file.type,
            senderId: currentUser.uid,
            timestamp: serverTimestamp()
          });
        }
      );
    }
    setShowFileMenu(false);
  };

  const startCall = (type: 'voice' | 'video') => {
    setCallState({
      isActive: true,
      type,
      status: 'calling',
      isMuted: false,
      isCameraOff: type === 'voice'
    });

    // Simulate connection logic
    // 50% chance of "no answer" for demo purposes, unless it's the bot (always answers)
    const willAnswer = chat.isBot || Math.random() > 0.5;

    setTimeout(() => {
      if (willAnswer) {
        setCallState(prev => prev ? { ...prev, status: 'connected' } : null);
      } else {
        setCallState(prev => prev ? { ...prev, status: 'failed' } : null);
        // Auto close failed call after 3 seconds
        setTimeout(() => setCallState(null), 3000);
      }
    }, 4000); // Ring for 4 seconds
  };

  const endCall = () => {
    setCallState(null);
  };

  const toggleMute = () => {
    setCallState(prev => prev ? { ...prev, isMuted: !prev.isMuted } : null);
  };

  const toggleCamera = () => {
    setCallState(prev => prev ? { ...prev, isCameraOff: !prev.isCameraOff } : null);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatLastSeen = (date?: Date) => {
    if (!date) return '';
    return `Last seen ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="flex flex-col h-full bg-black relative"
    >
      <AnimatePresence>
        {callState && (
          <CallOverlay 
            chat={chat} 
            callState={callState} 
            onEndCall={endCall}
            onToggleMute={toggleMute}
            onToggleCamera={toggleCamera}
            theme={theme}
          />
        )}
      </AnimatePresence>

      {/* Chat Header */}
      <div className="px-4 py-4 flex items-center justify-between border-b border-zinc-900/50 bg-black/80 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 -ml-2 text-zinc-400 hover:text-white transition-colors">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div className="w-10 h-10 rounded-full bg-zinc-900 flex items-center justify-center border border-zinc-800 overflow-hidden relative">
            {chat.avatar ? (
              <img src={chat.avatar} alt={chat.name} className="w-full h-full object-cover" />
            ) : (
              <User className="w-5 h-5 text-zinc-600" />
            )}
            {chat.isOnline && (
               <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 ${themeConfig.primary.replace('text-', 'bg-')} rounded-full border-2 border-black`}></div>
            )}
          </div>
        <div onClick={() => chat.isGroup && setShowGroupInfo(true)} className={chat.isGroup ? "cursor-pointer" : ""}>
            <h3 className="font-medium text-white flex items-center gap-1">
              {chat.name}
              {chat.isOfficial && <CheckCircle className="w-3 h-3 text-white fill-blue-500" />}
            </h3>
            <p className="text-xs text-zinc-500">
              {isTyping ? (
                <span className={`${themeConfig.primary} animate-pulse`}>typing...</span>
              ) : chat.isBot ? (
                'Official Bot'
              ) : chat.isGroup ? (
                `${chat.members?.length || 0} members`
              ) : chat.isOnline ? (
                <span className={themeConfig.primary}>Online</span>
              ) : (
                formatLastSeen(chat.lastSeen)
              )}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          {!chat.isGroup && !chat.isBot && (
            <>
              <button 
                onClick={() => startCall('voice')}
                className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-900 rounded-full transition-colors"
              >
                <Phone className="w-5 h-5" />
              </button>
              <button 
                onClick={() => startCall('video')}
                className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-900 rounded-full transition-colors"
              >
                <Video className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </div>

      {showGroupInfo && (
        <div className="fixed inset-0 bg-black/90 flex items-end sm:items-center justify-center z-50 sm:p-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-2xl p-6 max-w-sm w-full h-[80vh] sm:h-auto overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-4">
                <button onClick={() => setShowGroupInfo(false)} className="text-zinc-400 hover:text-white">
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <h3 className="text-xl font-medium text-white">Group Info</h3>
              </div>
              <div className="relative">
                <button onClick={() => setShowMenu(!showMenu)} className="text-zinc-400 hover:text-white">
                  <MoreVertical className="w-6 h-6" />
                </button>
                {showMenu && (
                  <div className="absolute right-0 top-8 bg-zinc-800 border border-zinc-700 rounded-xl p-2 shadow-xl z-50 w-40">
                    <button 
                      onClick={() => {
                        setShowMenu(false);
                        setShowLeaveConfirmation(true);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-zinc-700 rounded-lg"
                    >
                      Leave Group
                    </button>
                  </div>
                )}
              </div>
            </div>
            
            {showLeaveConfirmation && (
              <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-6">
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-sm w-full">
                  <h3 className="text-lg font-medium text-white mb-4">Leave Group?</h3>
                  <p className="text-zinc-400 text-sm mb-6">Are you sure you want to leave this group?</p>
                  <div className="flex gap-4">
                    <button onClick={() => setShowLeaveConfirmation(false)} className="flex-1 py-2 bg-zinc-800 text-white rounded-lg">No</button>
                    <button 
                      onClick={async () => {
                        // Logic to remove user from group
                        await updateDoc(doc(db, "chats", chat.id), {
                          members: chat.members?.filter(m => m !== currentUser.uid)
                        });
                        setShowLeaveConfirmation(false);
                        setShowGroupInfo(false);
                      }} 
                      className="flex-1 py-2 bg-red-600 text-white rounded-lg"
                    >
                      Yes
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex flex-col items-center mb-6">
              <div className="w-24 h-24 rounded-full bg-zinc-800 flex items-center justify-center mb-4 overflow-hidden border border-zinc-700">
                {chat.avatar ? (
                  <img src={chat.avatar} alt={chat.name} className="w-full h-full object-cover" />
                ) : (
                  <User className="w-12 h-12 text-zinc-600" />
                )}
              </div>
              <h2 className="text-2xl font-semibold text-white">{chat.name}</h2>
              <p className="text-zinc-500 text-sm">{chat.members?.length || 0} members</p>
            </div>

            {chat.description && (
              <div className="mb-6">
                <h4 className="text-zinc-400 text-xs uppercase tracking-wider mb-2">Description</h4>
                <p className="text-white text-sm">{chat.description}</p>
              </div>
            )}

            <div className="mb-6 bg-zinc-800 p-4 rounded-xl flex items-center justify-between">
              <div>
                <h4 className="text-zinc-400 text-xs uppercase tracking-wider mb-1">Invite Link</h4>
                <p className="text-emerald-400 text-sm break-all">noir-messenger.vercel.app/join/{chat.id}</p>
              </div>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(`https://noir-messenger.vercel.app/join/${chat.id}`);
                  alert("Link copied to clipboard!");
                }}
                className="text-zinc-400 hover:text-white transition-colors"
              >
                Copy
              </button>
            </div>

            {!chat.members?.includes(currentUser.uid) && (
              <button 
                onClick={() => {
                  // Simulate joining
                  alert("Joining group...");
                  setShowGroupInfo(false);
                }}
                className="w-full py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors mb-6"
              >
                Join Group
              </button>
            )}

            <h4 className="text-zinc-400 text-xs uppercase tracking-wider mb-3">Members</h4>
            <div className="space-y-4">
              {chat.members?.map(memberId => {
                const profile = memberProfiles[memberId];
                return (
                  <div key={memberId} className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden">
                      {profile?.avatar ? (
                        <img src={profile.avatar} alt={profile.name} className="w-full h-full object-cover" />
                      ) : (
                        <User className="w-5 h-5 text-zinc-600" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-white text-sm font-medium">{profile?.name || `User ${memberId.slice(0, 5)}`}</p>
                      <p className="text-zinc-500 text-xs">{memberId === chat.owner ? "Owner" : "Member"}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {chat.isBot ? (
             <div className="flex flex-col items-start">
                <div className="max-w-[85%] bg-zinc-900 text-zinc-200 border border-zinc-800 rounded-2xl rounded-tl-sm px-4 py-3 text-sm relative group">
                  <h3 className="font-bold text-white mb-2 text-base">Noir Messenger 1.1 Update</h3>
                  <p className="mb-2">We are excited to announce the release of version 1.1! Here's what's new:</p>
                  <ul className="list-disc list-inside space-y-1 text-zinc-300 mb-3">
                    <li>Official News Bot integration</li>
                    <li>Enhanced Security Settings (Password Change)</li>
                    <li>Language Support (English/Russian)</li>
                    <li>UI/UX Improvements</li>
                  </ul>
                  <p className="text-zinc-400 text-xs">Thank you for using Noir Messenger.</p>
                </div>
                <span className="text-[10px] text-zinc-600 mt-1 px-1">
                  {formatTime(new Date())}
                </span>
             </div>
        ) : (
          messages.map((msg) => (
            <div 
              key={msg.id} 
              className={`flex flex-col ${msg.sender === 'me' ? 'items-end' : msg.sender === 'system' ? 'items-center' : 'items-start'}`}
            >
              {msg.sender === 'system' ? (
                <div className="bg-zinc-800/50 text-zinc-400 text-xs px-3 py-1 rounded-full">
                  {msg.text}
                </div>
              ) : (
                <>
                  <div 
                    className={`max-w-[80%] px-4 py-2 rounded-2xl text-sm relative group ${
                      msg.sender === 'me' 
                        ? 'bg-white text-black rounded-tr-sm' 
                        : 'bg-zinc-900 text-zinc-200 border border-zinc-800 rounded-tl-sm'
                    }`}
                  >
                    {msg.text}
                  </div>
                  <span className="text-[10px] text-zinc-600 mt-1 px-1">
                    {formatTime(msg.timestamp)}
                  </span>
                </>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      {chat.isBot ? (
        <div className="p-4 border-t border-zinc-900/50 bg-black/80 backdrop-blur-lg text-center text-zinc-500 text-sm">
          This bot is read-only.
        </div>
      ) : (
        <div className="p-4 border-t border-zinc-900/50 bg-black/80 backdrop-blur-lg relative">
          {showEmojiPicker && (
            <div className="absolute bottom-20 left-4 z-50 bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl">
              <div className="flex border-b border-zinc-800">
                <button 
                  onClick={() => setActiveTab('stickers')}
                  className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider ${activeTab === 'stickers' ? 'text-white border-b-2 border-emerald-500' : 'text-zinc-500'}`}
                >
                  Stickers
                </button>
                <button 
                  onClick={() => setActiveTab('emoji')}
                  className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider ${activeTab === 'emoji' ? 'text-white border-b-2 border-emerald-500' : 'text-zinc-500'}`}
                >
                  Emoji
                </button>
                <button 
                  onClick={() => setActiveTab('gifs')}
                  className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider ${activeTab === 'gifs' ? 'text-white border-b-2 border-emerald-500' : 'text-zinc-500'}`}
                >
                  GIFs
                </button>
              </div>
              
              <div className="h-[300px] overflow-y-auto">
                {activeTab === 'emoji' && (
                  <EmojiPicker 
                    onEmojiClick={(emojiData) => {
                      setInputText(prev => prev + emojiData.emoji);
                    }}
                    theme={'dark' as any}
                    emojiStyle={'apple' as any}
                    searchDisabled={true}
                    skinTonesDisabled={true}
                    width={300}
                    height={300}
                  />
                )}
                {activeTab === 'stickers' && (
                  <div className="p-2 space-y-4">
                    <div className="flex items-center justify-between bg-zinc-800/50 p-3 rounded-xl">
                      <div className="flex items-center gap-3">
                        <img src="https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNHJqZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4JmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/3o7TKMGpxxHOGTdzJC/giphy.gif" alt="Animated Sticker" className="w-12 h-12 rounded-lg object-cover" />
                        <div>
                          <p className="text-white text-sm font-medium">Animated Bunny</p>
                          <p className="text-zinc-500 text-xs">20 stickers</p>
                        </div>
                      </div>
                      <button className="text-emerald-500 text-xs font-medium bg-emerald-500/10 px-3 py-1 rounded-full">Added</button>
                    </div>
                  </div>
                )}
                {activeTab === 'gifs' && (
                  <div className="p-2">
                    <input type="text" placeholder="Search GIFs..." className="w-full bg-zinc-800 text-white text-sm rounded-full px-4 py-2 mb-4 outline-none" />
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNHJqZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4JmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/l41lTjJp8WhY4GAKs/giphy.gif',
                        'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNHJqZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4JmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/3o7TKVUn7iM8FMEU24/giphy.gif',
                        'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNHJqZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4JmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/xT9IgzoKnwH49F7X3y/giphy.gif',
                        'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNHJqZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4JmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/3o7TKMGpxxHOGTdzJC/giphy.gif',
                        'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNHJqZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4ZzR4JmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/l41lTjJp8WhY4GAKs/giphy.gif'
                      ].map((url, i) => (
                        <img key={i} src={url} alt="GIF" className="w-full h-24 object-cover rounded-lg" />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className={`flex items-center gap-2 bg-zinc-900/50 border border-zinc-800 rounded-full px-4 py-2 ${themeConfig.border} transition-colors`}>
            <button 
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="text-zinc-400 hover:text-white transition-colors"
            >
              <Smile className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setShowFileMenu(!showFileMenu)}
              className="text-zinc-400 hover:text-white transition-colors"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            {showFileMenu && (
              <div className="absolute bottom-20 left-12 z-50 bg-zinc-900 border border-zinc-800 rounded-2xl p-2 shadow-2xl flex flex-col gap-1">
                {[
                  { label: 'Photo', accept: 'image/*' },
                  { label: 'Video', accept: 'video/*' },
                  { label: 'Music', accept: 'audio/*' },
                  { label: 'File', accept: '*' }
                ].map((item) => (
                  <button 
                    key={item.label}
                    onClick={() => {
                      if (fileInputRef.current) {
                        fileInputRef.current.accept = item.accept;
                        fileInputRef.current.click();
                      }
                    }}
                    className="px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 rounded-lg text-left"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
            <input 
              type="file" 
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
              multiple
            />
            <input 
              type="text" 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Type a message..."
              className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-zinc-600 text-sm"
            />
            <button 
              onClick={handleSend}
              disabled={!inputText.trim()}
              className="p-2 bg-white rounded-full text-black disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-200 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
};

const ChatsScreen: FC<{ 
  chats: Chat[]; 
  onChatSelect: (chat: Chat) => void; 
  onAddChat: (username: string) => void;
  onCreateGroup: (name: string, description: string, avatar: string | null) => void;
  theme: Theme; 
}> = ({ chats, onChatSelect, onAddChat, onCreateGroup, theme }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const themeConfig = THEMES[getSafeTheme(theme)];
  
  const filteredChats = chats.filter(chat => 
    chat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    chat.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isGlobalSearch = searchQuery.length > 0 && filteredChats.length === 0;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3 }}
      className="h-full overflow-y-auto p-4"
    >
      <div className="flex justify-between items-center mb-4 px-2">
        <h2 className="text-2xl font-light tracking-tight text-white">Messages</h2>
        <button 
          onClick={() => setShowCreateGroup(true)}
          className="p-2 bg-zinc-900 rounded-full hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-white"
          title="Create Group"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>
      
      {showCreateGroup && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 max-w-sm w-full">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-medium text-white">Create Group</h3>
              <button onClick={() => setShowCreateGroup(false)} className="text-zinc-400 hover:text-white">
                <ChevronLeft className="w-6 h-6" />
              </button>
            </div>
            <input type="text" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group Name" className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white mb-4" />
            <input type="text" value={groupDescription} onChange={(e) => setGroupDescription(e.target.value)} placeholder="Description (optional)" className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white mb-4" />
            <button 
              onClick={() => {
                onCreateGroup(groupName, groupDescription, null);
                setShowCreateGroup(false);
                setGroupName('');
                setGroupDescription('');
              }}
              className="w-full py-3 bg-white text-black rounded-xl font-medium hover:bg-zinc-200 transition-colors"
            >
              Create
            </button>
          </div>
        </div>
      )}
      <div className="mb-6 px-2">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by username..."
            className={`w-full bg-zinc-900/50 border border-zinc-800 rounded-xl pl-4 pr-10 py-3 text-white ${themeConfig.border} focus:outline-none transition-colors text-sm`}
          />
          <div className="absolute right-3 top-3 text-zinc-500">
             <MessageSquare className="w-5 h-5" />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {filteredChats.length > 0 ? (
          filteredChats.map((chat) => (
            <motion.button
              key={chat.id}
              whileTap={{ scale: 0.98 }}
              onClick={() => onChatSelect(chat)}
              className="w-full flex items-center gap-4 p-4 rounded-2xl hover:bg-zinc-900/50 transition-colors border border-transparent hover:border-zinc-800/50 group"
            >
              <div className="relative">
                <div className="w-12 h-12 rounded-full bg-zinc-900 flex items-center justify-center border border-zinc-800 group-hover:border-zinc-700 transition-colors overflow-hidden">
                  {chat.avatar ? (
                    <img src={chat.avatar} alt={chat.name} className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-6 h-6 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                  )}
                </div>
                {chat.isOnline && (
                  <div className={`absolute bottom-0 right-0 w-3 h-3 ${themeConfig.primary.replace('text-', 'bg-')} rounded-full border-2 border-black`}></div>
                )}
                {chat.unread > 0 && (
                  <div className={`absolute -top-1 -right-1 w-4 h-4 ${themeConfig.primary.replace('text-', 'bg-')} rounded-full border-2 border-black flex items-center justify-center`}>
                    <span className="text-[10px] font-bold text-black">{chat.unread}</span>
                  </div>
                )}
              </div>
              <div className="flex-1 text-left">
                <div className="flex justify-between items-baseline mb-1">
                  <h3 className={`font-medium text-white group-hover:${themeConfig.primary} transition-colors flex items-center gap-1`}>
                    {chat.name}
                    {chat.isOfficial && <CheckCircle className="w-3 h-3 text-white fill-blue-500" />}
                  </h3>
                  <span className="text-xs text-zinc-600">Now</span>
                </div>
                <p className="text-sm text-zinc-500 truncate group-hover:text-zinc-400 transition-colors">
                  {chat.lastMessage}
                </p>
              </div>
            </motion.button>
          ))
        ) : isGlobalSearch ? (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-8"
          >
            <p className="text-zinc-500 text-sm mb-4">No local chats found.</p>
            <button 
              onClick={() => onAddChat(searchQuery)}
              className={`px-6 py-2 rounded-full border border-zinc-800 hover:bg-zinc-900 transition-colors text-sm ${themeConfig.primary}`}
            >
              Start chat with @{searchQuery}
            </button>
          </motion.div>
        ) : (
          <div className="text-center py-8 text-zinc-500 text-sm">
            No users found.
          </div>
        )}
      </div>
    </motion.div>
  );
};

const ProfileScreen: FC<{ profile: UserProfile; onUpdateProfile: (p: UserProfile) => void; onLogout: () => void }> = ({ profile, onUpdateProfile, onLogout }) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editedProfile, setEditedProfile] = useState(profile);
  const [showAbout, setShowAbout] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const themeConfig = THEMES[getSafeTheme(profile.theme)];

  // Load avatar from local storage on mount
  useEffect(() => {
    const loadLocalAvatar = async () => {
      try {
        const localAvatar = await localforage.getItem<string>(`avatar_${profile.uid}`);
        if (localAvatar && !profile.avatar) {
          setEditedProfile(prev => ({ ...prev, avatar: localAvatar }));
        }
      } catch (err) {
        console.error("Error loading local avatar:", err);
      }
    };
    if (profile.uid) {
      loadLocalAvatar();
    }
  }, [profile.uid, profile.avatar]);

  const handleSave = () => {
    onUpdateProfile(editedProfile);
    setIsEditing(false);
    setStorageError(false);
  };

  const handleCancel = () => {
    setEditedProfile(profile);
    setIsEditing(false);
    setStorageError(false);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setUploading(true);
      setStorageError(false);

      try {
        if (!profile.uid) throw new Error("User ID missing");

        // Compress the image
        const reduce = new ImageBlobReduce();
        const compressedBlob = await reduce.toBlob(file, { max: 800 });
        
        // Convert to base64 for local storage
        const reader = new FileReader();
        reader.readAsDataURL(compressedBlob);
        reader.onloadend = async () => {
          const base64data = reader.result as string;
          
          // Save locally immediately
          if (profile.uid) {
            await localforage.setItem(`avatar_${profile.uid}`, base64data);
          }
          
          // Update UI immediately with local version
          setEditedProfile(prev => ({ ...prev, avatar: base64data }));
        };

        // Upload to Firebase Storage in background
        const storageRef = ref(storage, `avatars/${profile.uid}/${Date.now()}_${file.name}`);
        const uploadTask = uploadBytesResumable(storageRef, compressedBlob);
        
        uploadTask.on('state_changed', 
          (snapshot) => {
            // Can track progress here if needed
          }, 
          (error) => {
            console.error("Error uploading avatar:", error);
            if (error.code === 'storage/retry-limit-exceeded' || error.code === 'storage/unknown') {
              setStorageError(true);
            }
          }, 
          async () => {
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            setEditedProfile(prev => ({ ...prev, avatar: downloadURL }));
          }
        );
        
      } catch (error: any) {
        console.error("Error processing/uploading avatar:", error);
      } finally {
        setUploading(false);
      }
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const removeAvatar = () => {
    setEditedProfile(prev => ({ ...prev, avatar: '' }));
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3 }}
      className="h-full overflow-y-auto p-6"
    >
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-2xl font-light tracking-tight text-white">{t('profile')}</h2>
        <div className="flex gap-2">
          <button 
            onClick={() => setShowHelp(true)}
            className="p-2 bg-zinc-900 rounded-full hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-white"
            title={t('help')}
          >
            <HelpCircle className="w-5 h-5" />
          </button>
          {!isEditing ? (
            <>
             <button 
              onClick={onLogout}
              className="p-2 bg-zinc-900 rounded-full hover:bg-red-900/30 transition-colors text-zinc-400 hover:text-red-400"
              title={t('logout')}
            >
              <X className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setIsEditing(true)}
              className="p-2 bg-zinc-900 rounded-full hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-white"
            >
              <Edit2 className="w-5 h-5" />
            </button>
            </>
          ) : (
            <>
            <button 
              onClick={handleCancel}
              className="p-2 bg-zinc-900 rounded-full hover:bg-red-900/30 transition-colors text-zinc-400 hover:text-red-400"
            >
              <X className="w-5 h-5" />
            </button>
            <button 
              onClick={handleSave}
              className="p-2 bg-white rounded-full hover:bg-zinc-200 transition-colors text-black"
            >
              <Save className="w-5 h-5" />
            </button>
            </>
          )}
        </div>
      </div>

      {showHelp && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 max-w-sm w-full">
            <h3 className="text-xl font-medium text-white mb-4">Помощь</h3>
            <p className="text-zinc-400 mb-6">
              Если у вас возникли вопросы, пожалуйста, пишите нам в Telegram: 
              <a href="https://t.me/NoirDevSupport" target="_blank" rel="noreferrer" className="text-white font-bold ml-1 hover:underline">@NoirDevSupport</a>
            </p>
            <button 
              onClick={() => setShowHelp(false)}
              className="w-full py-3 bg-white text-black rounded-xl font-medium hover:bg-zinc-200 transition-colors"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      {storageError && (
        <div className="mb-6 p-4 bg-red-900/20 border border-red-900/50 rounded-xl text-sm text-red-200">
          <p className="font-bold mb-2">Storage Not Configured</p>
          <p className="mb-2">The avatar upload failed because Firebase Storage is not enabled or configured.</p>
          <ol className="list-decimal list-inside space-y-1 opacity-80">
            <li>Go to <a href="https://console.firebase.google.com/project/noir2-ef642/storage" target="_blank" rel="noreferrer" className="underline hover:text-white">Firebase Console &gt; Storage</a></li>
            <li>Click <strong>Get Started</strong> to create the bucket.</li>
            <li>Set rules to <strong>Test Mode</strong> (allow read/write).</li>
          </ol>
        </div>
      )}

      <div className="flex flex-col items-center">
        <div className="relative mb-6 group">
          <div className="w-32 h-32 rounded-full bg-zinc-900 border-2 border-zinc-800 overflow-hidden flex items-center justify-center">
            {uploading ? (
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white"></div>
            ) : isEditing ? (
               editedProfile.avatar ? (
                 <img src={editedProfile.avatar} alt="Avatar" className="w-full h-full object-cover" />
               ) : (
                 <User className="w-12 h-12 text-zinc-600" />
               )
            ) : (
               profile.avatar ? (
                 <img src={profile.avatar} alt="Avatar" className="w-full h-full object-cover" />
               ) : (
                 <User className="w-12 h-12 text-zinc-600" />
               )
            )}
          </div>
          
          {isEditing && (
            <div className="absolute -bottom-2 -right-2 flex gap-2">
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                className="hidden" 
                accept="image/*"
              />
              <button 
                onClick={triggerFileInput}
                className="p-2 bg-white rounded-full text-black shadow-lg hover:bg-zinc-200 transition-colors"
                title="Upload Photo"
              >
                <Camera className="w-4 h-4" />
              </button>
              {editedProfile.avatar && (
                <button 
                  onClick={removeAvatar}
                  className="p-2 bg-red-500 rounded-full text-white shadow-lg hover:bg-red-600 transition-colors"
                  title="Remove Photo"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        {isEditing ? (
          <div className="w-full max-w-sm space-y-4">
            <div className="space-y-1">
              <label className="text-xs text-zinc-500 uppercase tracking-wider ml-1">Name</label>
              <input
                type="text"
                value={editedProfile.name}
                onChange={(e) => setEditedProfile({...editedProfile, name: e.target.value})}
                className={`w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white ${THEMES[getSafeTheme(editedProfile.theme)].border} focus:outline-none transition-colors`}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-zinc-500 uppercase tracking-wider ml-1">Username</label>
              <div className="relative">
                <span className="absolute left-4 top-3.5 text-zinc-500">@</span>
                <input
                  type="text"
                  value={editedProfile.username}
                  onChange={(e) => setEditedProfile({...editedProfile, username: e.target.value})}
                  className={`w-full bg-zinc-900/50 border border-zinc-800 rounded-xl pl-8 pr-4 py-3 text-white ${THEMES[getSafeTheme(editedProfile.theme)].border} focus:outline-none transition-colors`}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-zinc-500 uppercase tracking-wider ml-1">Bio</label>
              <textarea
                value={editedProfile.bio}
                onChange={(e) => setEditedProfile({...editedProfile, bio: e.target.value})}
                rows={3}
                className={`w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white ${THEMES[getSafeTheme(editedProfile.theme)].border} focus:outline-none transition-colors resize-none`}
              />
            </div>
            
            {/* Theme Selector */}
            <div className="space-y-2 pt-2">
              <label className="text-xs text-zinc-500 uppercase tracking-wider ml-1">Theme Color</label>
              <div className="flex gap-3 justify-center">
                {(Object.keys(THEMES) as Theme[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setEditedProfile({...editedProfile, theme: t})}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      editedProfile.theme === t 
                        ? 'border-white scale-110' 
                        : 'border-transparent opacity-50 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: t === 'emerald' ? '#10b981' : t === 'blue' ? '#3b82f6' : t === 'purple' ? '#a855f7' : t === 'rose' ? '#f43f5e' : '#f59e0b' }}
                  />
                ))}
              </div>
            </div>

          </div>
        ) : (
          <div className="text-center space-y-2">
            <h3 className="text-2xl font-medium text-white">{profile.name}</h3>
            <p className={`${themeConfig.primary} font-mono text-sm`}>@{profile.username}</p>
            <p className="text-zinc-400 max-w-xs mx-auto mt-4 leading-relaxed">{profile.bio}</p>
          </div>
        )}
      </div>

      <div className="mt-12 w-full max-w-sm mx-auto space-y-4">
        <button
          onClick={() => setShowSecurity(true)}
          className="w-full flex items-center justify-center gap-2 p-4 rounded-xl bg-zinc-900/30 hover:bg-zinc-900 border border-zinc-800/50 hover:border-zinc-800 transition-all text-zinc-500 hover:text-white group"
        >
          <Settings className="w-5 h-5 group-hover:text-emerald-400 transition-colors" />
          <span>{t('security')}</span>
        </button>
        <button
          onClick={() => setShowAbout(true)}
          className="w-full flex items-center justify-center gap-2 p-4 rounded-xl bg-zinc-900/30 hover:bg-zinc-900 border border-zinc-800/50 hover:border-zinc-800 transition-all text-zinc-500 hover:text-white group"
        >
          <Info className="w-5 h-5 group-hover:text-emerald-400 transition-colors" />
          <span>{t('about')}</span>
        </button>
      </div>

      {/* Security Modal */}
      <AnimatePresence>
        {showSecurity && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 max-w-sm w-full"
            >
              <h3 className="text-xl font-medium text-white mb-6">{showChangePassword ? t('changePassword') : t('security')}</h3>
              <div className="space-y-4">
                {showChangePassword ? (
                  <div className="space-y-3">
                    <input type="password" placeholder="Current Password" className="w-full p-3 bg-zinc-800 text-white rounded-xl" />
                    <input type="password" placeholder="New Password" className="w-full p-3 bg-zinc-800 text-white rounded-xl" />
                    <input type="password" placeholder="Confirm New Password" className="w-full p-3 bg-zinc-800 text-white rounded-xl" />
                    <button 
                      onClick={() => { alert('Password changed!'); setShowChangePassword(false); }}
                      className="w-full py-3 mt-2 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-500 transition-colors"
                    >
                      {t('save')}
                    </button>
                    <button 
                      onClick={() => setShowChangePassword(false)}
                      className="w-full py-3 bg-zinc-800 text-white rounded-xl font-medium hover:bg-zinc-700 transition-colors"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">{t('twoFactor')}</span>
                      <div className="w-10 h-6 bg-zinc-800 rounded-full p-1 cursor-pointer">
                        <div className="w-4 h-4 bg-zinc-600 rounded-full" />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">{t('lastSeen')}</span>
                      <div className="w-10 h-6 bg-emerald-600 rounded-full p-1 cursor-pointer flex justify-end">
                        <div className="w-4 h-4 bg-white rounded-full" />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">{t('language')}</span>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => useAppStore.getState().setLanguage('en')}
                          className={`px-3 py-1 rounded-lg text-sm ${useAppStore.getState().language === 'en' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}
                        >
                          EN
                        </button>
                        <button 
                          onClick={() => useAppStore.getState().setLanguage('ru')}
                          className={`px-3 py-1 rounded-lg text-sm ${useAppStore.getState().language === 'ru' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}
                        >
                          RU
                        </button>
                      </div>
                    </div>
                    <button 
                      onClick={() => setShowChangePassword(true)}
                      className="w-full py-3 mt-4 bg-zinc-800 text-white rounded-xl font-medium hover:bg-zinc-700 transition-colors"
                    >
                      {t('changePassword')}
                    </button>
                    <button 
                      onClick={() => setShowSecurity(false)}
                      className="w-full py-3 mt-6 bg-white text-black rounded-xl font-medium hover:bg-zinc-200 transition-colors"
                    >
                      {t('close')}
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* About App Modal */}
      <AnimatePresence>
        {showAbout && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-sm w-full relative shadow-2xl"
            >
              <button 
                onClick={() => setShowAbout(false)}
                className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
              
              <div className="flex flex-col items-center text-center space-y-4 pt-2">
                <div className="w-16 h-16 rounded-full bg-black border border-zinc-800 flex items-center justify-center shadow-inner">
                  <Ghost className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-medium text-white tracking-wide">Noir</h3>
                  <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-900/30 text-emerald-400 border border-emerald-900/50 mt-2">
                    Version 1.1
                  </div>
                </div>
                <p className="text-zinc-400 text-sm leading-relaxed px-4">
                  A minimal, secure, and fast chat application.
                </p>
                <div className="w-full text-left pt-4">
                  <p className="text-zinc-300 text-sm font-medium mb-2">What's New:</p>
                  <ul className="text-zinc-500 text-xs list-disc list-inside space-y-1">
                    <li>Official News Bot</li>
                    <li>Security Settings</li>
                    <li>Language support</li>
                  </ul>
                </div>
                <div className="pt-6 text-xs text-zinc-600 border-t border-zinc-800/50 w-full">
                  © 2026 Noir Inc.
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default function App() {
  const { activeTab, setActiveTab, userProfile, setUserProfile } = useAppStore();
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // User is signed in, fetch profile
        try {
          const docRef = doc(db, "users", user.uid);
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            setUserProfile(docSnap.data() as UserProfile);
          } else {
            // Create default profile if not exists
            const newProfile: UserProfile = {
              uid: user.uid,
              name: user.displayName || 'User',
              username: user.email?.split('@')[0] || 'user',
              avatar: user.photoURL || '',
              bio: 'Hey there! I am using Noir.',
              theme: 'emerald'
            };
            await setDoc(docRef, newProfile);
            setUserProfile(newProfile);
          }
          setDbError(false);
        } catch (error: any) {
          console.error("Error fetching profile:", error);
          if (error.code === 'unavailable' || error.message?.includes('offline') || error.message?.includes("Database '(default)' not found")) {
             setDbError(true);
          }
        }
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [setUserProfile]);

  // Listen for chats in Firestore
  useEffect(() => {
    if (!userProfile?.uid) return;

    const q = query(
      collection(db, "chats"), 
      where("participants", "array-contains", userProfile.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newChats: Chat[] = [];
      
      // Add News Bot
      newChats.push({
          id: 'news_bot',
          name: 'Noir News',
          username: 'noir_news',
          avatar: null,
          isBot: true,
          isOfficial: true,
          unread: 0,
          lastMessage: 'Welcome to Noir Messenger 1.1!',
          lastSeen: new Date(),
          isOnline: true,
          isGroup: false,
      });

      snapshot.forEach((doc) => {
        const data = doc.data();
        
        if (data.isGroup) {
          newChats.push({
            id: doc.id,
            name: data.name,
            username: data.name, // Groups don't have usernames in the same way
            avatar: data.avatar || '',
            lastMessage: data.lastMessage || 'No messages yet',
            unread: 0,
            isOnline: false,
            lastSeen: new Date(),
            isGroup: true,
            members: data.members,
            description: data.description,
            owner: data.owner
          });
        } else {
          // Determine the "other" user
          const otherUserId = data.participants.find((uid: string) => uid !== userProfile.uid);
          const otherUserData = data.participantData?.[otherUserId];

          if (otherUserData) {
            newChats.push({
              id: doc.id,
              name: otherUserData.name,
              username: otherUserData.username,
              avatar: otherUserData.avatar,
              lastMessage: data.lastMessage || 'No messages yet',
              unread: 0, 
              isOnline: false, 
              lastSeen: new Date(),
            });
          }
        }
      });
      // Sort locally by last message timestamp if available, or just fallback
      setChats(newChats);
    });

    return () => unsubscribe();
  }, [userProfile?.uid]);

  // Save profile to local storage handled by Zustand persist middleware

  const handleUpdateProfile = async (newProfile: UserProfile) => {
    setUserProfile(newProfile);
    if (userProfile?.uid) {
      try {
        await updateDoc(doc(db, "users", userProfile.uid), newProfile as any);
      } catch (e) {
        console.error("Error updating profile:", e);
        alert("Failed to update profile in database, but local state updated.");
      }
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUserProfile(null);
      setActiveTab('chats');
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const currentTheme = getSafeTheme(userProfile?.theme);
  const themeConfig = THEMES[currentTheme];

  const handleAddChat = async (username: string) => {
    if (!userProfile?.uid) return;
    
    // Check if chat already exists in local list (optimization)
    if (chats.some(c => c.username === username)) return;

    try {
      // 1. Find the user by username
      const q = query(collection(db, "users"), where("username", "==", username));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const targetUserDoc = querySnapshot.docs[0];
        const targetUserData = targetUserDoc.data() as UserProfile;
        const targetUserId = targetUserDoc.id;

        if (targetUserId === userProfile.uid) {
          alert("You cannot chat with yourself.");
          return;
        }

        // 2. Check if a chat document already exists for these two participants
        // Note: Firestore array-contains only handles one value. 
        // For exact match of two participants, it's trickier. 
        // For now, let's just create it. If we want to be strict, we'd query for existing chats.
        // A common pattern is to generate a deterministic ID like `uid1_uid2` (sorted).
        
        const sortedIds = [userProfile.uid, targetUserId].sort();
        const chatId = `${sortedIds[0]}_${sortedIds[1]}`;
        const chatDocRef = doc(db, "chats", chatId);
        const chatDocSnap = await getDoc(chatDocRef);

        if (!chatDocSnap.exists()) {
          // Create new chat
          await setDoc(chatDocRef, {
            participants: [userProfile.uid, targetUserId],
            participantData: {
              [userProfile.uid]: {
                name: userProfile.name,
                username: userProfile.username,
                avatar: userProfile.avatar
              },
              [targetUserId]: {
                name: targetUserData.name,
                username: targetUserData.username,
                avatar: targetUserData.avatar
              }
            },
            lastMessage: '',
            createdAt: serverTimestamp()
          });
        }

        // The onSnapshot listener will pick this up and add it to the list
        
      } else {
        alert("User not found.");
      }
    } catch (e) {
      console.error("Error adding chat:", e);
    }
  };

  const handleCreateGroup = async (name: string, description: string, avatar: string | null) => {
    if (!name.trim()) return;

    try {
      await addDoc(collection(db, "chats"), {
        name,
        description,
        avatar,
        isGroup: true,
        participants: [userProfile.uid],
        members: [userProfile.uid],
        owner: userProfile.uid,
        lastMessage: "",
        lastMessageTimestamp: serverTimestamp(),
        unread: 0
      });
      console.log("Group created");
    } catch (e) {
      console.error("Error creating group: ", e);
    }
  };

  if (dbError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-black text-white p-8 text-center space-y-6">
        <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
          <Settings className="w-10 h-10 text-red-500" />
        </div>
        <h1 className="text-3xl font-light">Database Not Found</h1>
        <p className="text-zinc-400 max-w-md">
          The Firestore database has not been created yet. This is required for the app to work.
        </p>
        <div className="bg-zinc-900 p-6 rounded-xl text-left max-w-md w-full space-y-4 border border-zinc-800">
          <h3 className="font-medium text-white">How to fix:</h3>
          <ol className="list-decimal list-inside text-sm text-zinc-400 space-y-2">
            <li>Go to the <a href="https://console.firebase.google.com/project/noir2-ef642/firestore" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">Firebase Console</a>.</li>
            <li>Click <strong>Create database</strong>.</li>
            <li>Select a location (e.g., <strong>nam5 (us-central)</strong>).</li>
            <li>Choose <strong>Start in test mode</strong>.</li>
            <li>Click <strong>Create</strong>.</li>
          </ol>
        </div>
        <button 
          onClick={() => window.location.reload()}
          className="px-8 py-3 bg-white text-black rounded-full font-medium hover:bg-zinc-200 transition-colors"
        >
          I've created it, Refresh App
        </button>
      </div>
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center h-screen bg-black text-white">Loading...</div>;
  }

  if (!userProfile) {
    return <AuthScreen />;
  }

  return (
    <div className="flex flex-col h-screen bg-black text-white font-sans selection:bg-zinc-800">
      {/* Header - Hide when in chat detail */}
      {!selectedChat && (
        <motion.header 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="px-6 py-6 flex items-center justify-between border-b border-zinc-900/50 backdrop-blur-md sticky top-0 z-10"
        >
          <div className="flex items-center gap-3">
            <Ghost className="w-6 h-6 text-white" />
            <h1 className="text-xl font-medium tracking-widest uppercase">Noir</h1>
          </div>
          <div className="relative flex items-center justify-center w-3 h-3">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${themeConfig.primary.replace('text-', 'bg-').replace('500', '400')}`}></span>
            <span className={`relative inline-flex rounded-full h-2 w-2 ${themeConfig.primary.replace('text-', 'bg-')} ${themeConfig.glow}`}></span>
          </div>
        </motion.header>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          {selectedChat ? (
            <ChatDetailScreen 
              key="chat-detail" 
              chat={selectedChat} 
              onBack={() => setSelectedChat(null)} 
              theme={currentTheme}
              currentUser={userProfile}
              db={db}
            />
          ) : activeTab === 'chats' ? (
            <ChatsScreen 
              key="chats" 
              chats={chats}
              onChatSelect={setSelectedChat} 
              onAddChat={handleAddChat}
              onCreateGroup={handleCreateGroup}
              theme={currentTheme}
            />
          ) : (
            <ProfileScreen 
              key="profile" 
              profile={userProfile} 
              onUpdateProfile={handleUpdateProfile} 
              onLogout={handleLogout}
            />
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation - Hide when in chat detail */}
      {!selectedChat && (
        <nav className="px-6 pb-8 pt-4 border-t border-zinc-900/50 bg-black/80 backdrop-blur-lg">
          <div className="flex justify-around items-center max-w-md mx-auto">
            <button 
              onClick={() => setActiveTab('chats')}
              className="group flex flex-col items-center gap-1 relative w-16"
            >
              <div className={`p-3 rounded-2xl transition-all duration-300 ${activeTab === 'chats' ? 'bg-white text-black' : 'text-zinc-500 hover:text-zinc-300'}`}>
                <MessageSquare className="w-6 h-6" strokeWidth={activeTab === 'chats' ? 2.5 : 2} />
              </div>
              {activeTab === 'chats' && (
                <motion.div 
                  layoutId="active-dot"
                  className={`absolute -bottom-2 w-1 h-1 rounded-full ${themeConfig.primary.replace('text-', 'bg-')}`}
                />
              )}
            </button>

            <button 
              onClick={() => setActiveTab('profile')}
              className="group flex flex-col items-center gap-1 relative w-16"
            >
              <div className={`p-3 rounded-2xl transition-all duration-300 ${activeTab === 'profile' ? 'bg-white text-black' : 'text-zinc-500 hover:text-zinc-300'}`}>
                <User className="w-6 h-6" strokeWidth={activeTab === 'profile' ? 2.5 : 2} />
              </div>
              {activeTab === 'profile' && (
                <motion.div 
                  layoutId="active-dot"
                  className={`absolute -bottom-2 w-1 h-1 rounded-full ${themeConfig.primary.replace('text-', 'bg-')}`}
                />
              )}
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
