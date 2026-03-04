import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyB1i7mkciebUi20mvbWhT5uUSbz8cpDg-s",
  authDomain: "noir2-ef642.firebaseapp.com",
  databaseURL: "https://noir2-ef642-default-rtdb.firebaseio.com",
  projectId: "noir2-ef642",
  storageBucket: "noir2-ef642.firebasestorage.app",
  messagingSenderId: "305441420722",
  appId: "1:305441420722:web:b9b8a53160b5698dc620ab",
  measurementId: "G-TMHP1R9T0H"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { app, analytics, auth, db, storage };
