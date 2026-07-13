import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf-8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);

async function test() {
  try {
    await signInWithEmailAndPassword(auth, "technoverse.admin@gmail.com", "T7vX9zR2mK4w");
    console.log("Logged in");
    
    // Add a dummy doc
    const ref = doc(db, "products", "test-doc");
    await setDoc(ref, { test: true });
    console.log("Wrote doc");
    
    const snap = await getDoc(ref);
    console.log("Read doc:", snap.data());
    
    // List all products
    const colSnap = await getDocs(collection(db, "products"));
    console.log("Products count:", colSnap.size);
    
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
test();
