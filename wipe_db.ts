import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, deleteDoc } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');

async function wipe() {
  const collections = ['productos', 'repuestos', 'ordenesReparacion', 'ordenesVenta', 'usuarios', 'configuracion', 'movimientosInventario', 'historicalSKUs'];
  for (const col of collections) {
    const snapshot = await getDocs(collection(db, col));
    for (const doc of snapshot.docs) {
      await deleteDoc(doc.ref);
    }
  }
  console.log('Wiped database');
}
wipe();
