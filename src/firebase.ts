import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyC7uBSZiKWL7GTdxBqbU2GV58-0tvB_3CU",
  authDomain: "noir-dfc43.firebaseapp.com",
  projectId: "noir-dfc43",
  storageBucket: "noir-dfc43.firebasestorage.app",
  messagingSenderId: "714152043821",
  appId: "1:714152043821:web:12cab4fd71e46a03575fa4",
  measurementId: "G-QQZCV0J871"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

export { app, analytics };
