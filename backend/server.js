const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3001;
const SERVER_VERSION = "2.1";
console.log(`Iniciando Backend Documental - Versión ${SERVER_VERSION}`);

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
      include: { 
        documents: {
          orderBy: { id: 'asc' }
        } 
      },
      orderBy: { id: 'asc' }
    });
    res.json(students);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener alumnos' });
  }
});

app.post('/api/students', async (req, res) => {
  try {
    const { name, company, startDate, endDate, documents } = req.body;
    const student = await prisma.student.create({
      data: {
        name,
        company,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        documents: {
          create: documents.map(doc => ({
            category: doc.category,
            signatures: doc.signatures || [],
            applies: doc.applies !== undefined ? doc.applies : true,
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
    const { name, company, startDate, endDate, documents } = req.body;

    const oldStudent = await prisma.student.findUnique({
      where: { id: Number(id) },
      include: { documents: true }
    });

    // Renombrar carpeta si el nombre cambió
    if (oldStudent && oldStudent.name !== name) {
      const oldPath = path.join(__dirname, 'uploads', oldStudent.name.replace(/[/\\?%*:|"<>]/g, '-'));
      const newPath = path.join(__dirname, 'uploads', name.replace(/[/\\?%*:|"<>]/g, '-'));

      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
        
        // Actualizar todos los filePaths en la DB
        for (const doc of oldStudent.documents) {
          if (doc.filePath) {
            const newFilePath = doc.filePath.replace(
              `/uploads/${oldStudent.name.replace(/[/\\?%*:|"<>]/g, '-')}`,
              `/uploads/${name.replace(/[/\\?%*:|"<>]/g, '-')}`
            );
            await prisma.document.update({
              where: { id: doc.id },
              data: { filePath: newFilePath }
            });
          }
        }
      }
    }

    // Actualizar datos del alumno
    await prisma.student.update({
      where: { id: Number(id) },
      data: { 
        name,
        company,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null
      }
    });

    // Actualizar cada documento
    if (documents) {
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
    }

    const updated = await prisma.student.findUnique({
      where: { id: Number(id) },
      include: { 
        documents: {
          orderBy: { id: 'asc' }
        } 
      }
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
    if (!req.file) {
      console.error("Subida fallida: No se recibió archivo");
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    const doc = await prisma.document.findUnique({
      where: { id: Number(docId) },
      include: { student: true }
    });

    if (!doc) {
      console.error(`Documento no encontrado: ${docId}`);
      return res.status(404).json({ error: 'Documento no encontrado' });
    }

    const studentFolderName = doc.student.name.replace(/[/\\?%*:|"<>]/g, '-');
    const targetDir = path.join(__dirname, 'uploads', studentFolderName);
    
    // Crear directorio si no existe
    try {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
    } catch (err) {
      console.error(`Error al crear directorio ${targetDir}:`, err.message);
      return res.status(500).json({ error: 'Error de permisos al crear carpeta del alumno' });
    }

    const newFileName = `${Date.now()}-${req.file.originalname}`;
    const newPath = path.join(targetDir, newFileName);

    // Mover archivo de forma robusta
    try {
      fs.renameSync(req.file.path, newPath);
    } catch (err) {
      console.warn("renameSync falló, intentando copy+unlink:", err.message);
      fs.copyFileSync(req.file.path, newPath);
      fs.unlinkSync(req.file.path);
    }

    const filePath = `/uploads/${studentFolderName}/${newFileName}`;

    // Eliminar archivo antiguo si existe
    if (doc.filePath) {
      const oldFilePath = path.join(__dirname, doc.filePath);
      if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
    }

    await prisma.document.update({
      where: { id: Number(docId) },
      data: { filePath }
    });
    
    console.log(`Subida exitosa: ${filePath}`);
    res.json({ filePath });
  } catch (error) {
    console.error("Error crítico en subida:", error);
    res.status(500).json({ error: 'Error interno al procesar la subida' });
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
    console.log(`Firma actualizada en documento: ${docId} (Versión ${SERVER_VERSION})`);
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
function getPredefinedDocuments() {
  return [
    { name: 'Anexo I', requiredSignatures: ['Dirección', 'Responsable/Representante de la empresa'], optional: true },
    { name: 'Anexo II', requiredSignatures: ['Dirección', 'Tutor centro', 'Responsable/Representante de la empresa'], optional: false },
    { name: 'Anexo III', requiredSignatures: ['Alumno', 'Tutor empresa', 'Tutor centro'], optional: false },
    { name: 'Autorización periodo extraordinario', requiredSignatures: ['Alumno', 'Tutor centro', 'Dirección'], optional: true }
  ];
}

app.get('/api/predefined-documents', (req, res) => {
  res.json(getPredefinedDocuments());
});

// ---------- Importar desde Excel/CSV ----------
app.post('/api/students/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });

    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      // Si ya es un objeto Date (XLSX puede parsear algunas fechas automáticamente)
      if (dateStr instanceof Date) return dateStr;
      
      // Intentar parsear DD/MM/AAAA
      const parts = String(dateStr).split('/');
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        const date = new Date(year, month, day);
        return isNaN(date.getTime()) ? null : date;
      }
      
      // Fallback a constructor estándar
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? null : d;
    };

    const predefined = getPredefinedDocuments();

    for (const row of data) {
      const name = row['Nombre'] || row['nombre'];
      if (!name) continue;

      const company = row['Empresa'] || row['empresa'] || '';
      const startDate = parseDate(row['Fecha Inicio'] || row['fecha_inicio'] || row['inicio']);
      const endDate = parseDate(row['Fecha Fin'] || row['fecha_fin'] || row['fin']);

      await prisma.student.create({
        data: {
          name,
          company,
          startDate,
          endDate,
          documents: {
            create: predefined.map(p => ({
              category: p.name,
              signatures: p.requiredSignatures.map(s => ({ name: s, present: false })),
              applies: !p.optional,
              optional: p.optional
            }))
          }
        }
      });
    }

    // Limpiar archivo temporal
    fs.unlinkSync(req.file.path);

    res.json({ success: true, message: `${data.length} registros procesados.` });
  } catch (error) {
    console.error('Error en importación:', error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Error al procesar el archivo de importación' });
  }
});

// ---------- Exportar/Importar metadatos ----------
app.get('/api/export', async (req, res) => {
  try {
    const students = await prisma.student.findMany({
      include: { 
        documents: {
          orderBy: { id: 'asc' }
        } 
      },
      orderBy: { id: 'asc' }
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