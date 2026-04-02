const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configuración de multer para guardar PDFs
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});
const upload = multer({ 
  storage, 
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Solo se permiten PDFs'));
  }
});

// ---------- CRUD de Alumnos ----------
app.get('/api/students', async (req, res) => {
  try {
    const students = await prisma.student.findMany({
      include: { documents: true }
    });
    res.json(students);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener alumnos' });
  }
});

app.post('/api/students', async (req, res) => {
  try {
    const { name, documents } = req.body;
    const student = await prisma.student.create({
      data: {
        name,
        documents: {
          create: documents.map(doc => ({
            category: doc.category,
            signatures: doc.signatures || [],
            applies: doc.applies !== undefined ? doc.applies : true,   // nuevo campo
            optional: doc.optional || false
          }))
        }
      },
      include: { documents: true }
    });
    res.json(student);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear alumno' });
  }
});

app.put('/api/students/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, documents } = req.body;
    // Actualizar nombre
    await prisma.student.update({
      where: { id: Number(id) },
      data: { name }
    });
    // Actualizar cada documento
    for (const doc of documents) {
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          signatures: doc.signatures,
          category: doc.category,
          applies: doc.applies
        }
      });
    }
    const updated = await prisma.student.findUnique({
      where: { id: Number(id) },
      include: { documents: true }
    });
    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar alumno' });
  }
});

app.delete('/api/students/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const student = await prisma.student.findUnique({
      where: { id: Number(id) },
      include: { documents: true }
    });
    if (student && student.documents) {
      for (const doc of student.documents) {
        if (doc.filePath) {
          const filePath = path.join(__dirname, doc.filePath);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
      }
    }
    await prisma.student.delete({ where: { id: Number(id) } });
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar alumno' });
  }
});

// ---------- Documentos y archivos ----------
app.post('/api/documents/:docId/upload', upload.single('pdf'), async (req, res) => {
  try {
    const { docId } = req.params;
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
    const filePath = `/uploads/${req.file.filename}`;
    
    const existingDoc = await prisma.document.findUnique({ where: { id: Number(docId) } });
    if (existingDoc && existingDoc.filePath) {
      const oldFilePath = path.join(__dirname, existingDoc.filePath);
      if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
    }
    
    await prisma.document.update({
      where: { id: Number(docId) },
      data: { filePath }
    });
    res.json({ filePath });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al subir archivo' });
  }
});

app.put('/api/documents/:docId/signatures', async (req, res) => {
  try {
    const { docId } = req.params;
    const { signatures } = req.body;
    const doc = await prisma.document.update({
      where: { id: Number(docId) },
      data: { signatures }
    });
    res.json(doc);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar firmas' });
  }
});

app.delete('/api/documents/:docId/pdf', async (req, res) => {
  try {
    const { docId } = req.params;
    const doc = await prisma.document.findUnique({ where: { id: Number(docId) } });
    if (!doc || !doc.filePath) {
      return res.status(404).json({ error: 'Documento sin archivo' });
    }
    const filePath = path.join(__dirname, doc.filePath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await prisma.document.update({
      where: { id: Number(docId) },
      data: { filePath: null }
    });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar PDF' });
  }
});

// ---------- Predefinidos (con soporte para optativos) ----------
app.get('/api/predefined-documents', (req, res) => {
  const docs = [
    { id: 'id_doc', name: 'Identificación oficial', requiredSignatures: ['Alumno', 'Coordinador'], optional: false },
    { id: 'certificate', name: 'Certificado de estudios', requiredSignatures: ['Alumno', 'Secretaría'], optional: false },
    { id: 'contract', name: 'Contrato de servicios', requiredSignatures: ['Alumno', 'Tutor', 'Coordinador'], optional: true },
    { id: 'medical', name: 'Seguro médico', requiredSignatures: ['Alumno'], optional: true }
  ];
  res.json(docs);
});

// ---------- Exportar/Importar metadatos ----------
app.get('/api/export', async (req, res) => {
  try {
    const students = await prisma.student.findMany({
      include: { documents: true }
    });
    res.json(students);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al exportar' });
  }
});

app.post('/api/import', async (req, res) => {
  try {
    const data = req.body;
    await prisma.$transaction([
      prisma.document.deleteMany(),
      prisma.student.deleteMany()
    ]);
    for (const student of data) {
      await prisma.student.create({
        data: {
          name: student.name,
          documents: {
            create: student.documents.map(doc => ({
              category: doc.category,
              filePath: doc.filePath,
              signatures: doc.signatures,
              applies: doc.applies !== undefined ? doc.applies : true,
              optional: doc.optional || false
            }))
          }
        }
      });
    }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al importar' });
  }
});

app.listen(PORT, () => {
  console.log(`Backend corriendo en http://localhost:${PORT}`);
});