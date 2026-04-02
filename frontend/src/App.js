import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = '/api';
const APP_VERSION = "2.2"; // Eliminada opción de firmar
console.log(`%cIniciando GESTIÓN DOCUMENTAL v${APP_VERSION}`, "background: #4f46e5; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;");

function App() {
  const [students, setStudents] = useState([]);
  const [predefinedDocs, setPredefinedDocs] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', company: '', startDate: '', endDate: '', documents: [] });
  const [expandedStudent, setExpandedStudent] = useState(null);

  useEffect(() => {
    fetchStudents();
    fetchPredefined();
  }, []);

  const fetchStudents = async () => {
    try {
      const res = await axios.get(`${API_URL}/students`);
      // Ordenar alumnos por ID y sus documentos por ID para evitar saltos en la UI
      const sorted = (res.data || []).map(s => ({
        ...s,
        documents: (s.documents || []).sort((a, b) => (a.id || 0) - (b.id || 0))
      })).sort((a, b) => a.id - b.id);
      setStudents(sorted);
    } catch (error) {
      console.error('Error fetching students:', error);
    }
  };

  const fetchPredefined = async () => {
    try {
      const res = await axios.get(`${API_URL}/predefined-documents`);
      setPredefinedDocs(res.data);
    } catch (error) {
      console.error('Error fetching predefined docs:', error);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) return alert('El nombre es obligatorio');

    try {
      if (editing) {
        await axios.put(`${API_URL}/students/${editing.id}`, {
          name: form.name,
          company: form.company,
          startDate: form.startDate,
          endDate: form.endDate,
          documents: form.documents.map(doc => ({
            id: doc.id,
            category: doc.category,
            signatures: doc.signatures,
            applies: doc.applies
          }))
        });
      } else {
        await axios.post(`${API_URL}/students`, {
          name: form.name,
          company: form.company,
          startDate: form.startDate,
          endDate: form.endDate,
          documents: form.documents.map(doc => ({
            category: doc.category,
            signatures: doc.signatures,
            applies: doc.applies,
            optional: doc.optional
          }))
        });
      }
      setShowModal(false);
      fetchStudents();
    } catch (error) {
      console.error('Error saving student:', error);
      alert('Error al guardar el alumno');
    }
  };

  const handleDeleteStudent = async (id) => {
    if (!window.confirm('¿Eliminar alumno y todos sus documentos?')) return;
    try {
      await axios.delete(`${API_URL}/students/${id}`);
      fetchStudents();
    } catch (error) {
      console.error('Error deleting student:', error);
      alert('Error al eliminar alumno');
    }
  };

  const handleUpload = async (docId, file) => {
    if (!file) return;
    const formData = new FormData();
    formData.append('pdf', file);
    try {
      await axios.post(`${API_URL}/documents/${docId}/upload`, formData);
      fetchStudents();
    } catch (error) {
      console.error('Error uploading PDF:', error);
      alert('Error al subir el PDF');
    }
  };

  const handleDeletePdf = async (docId) => {
    if (!window.confirm('¿Eliminar este archivo PDF?')) return;
    try {
      await axios.delete(`${API_URL}/documents/${docId}/pdf`);
      fetchStudents();
    } catch (error) {
      console.error('Error deleting PDF:', error);
      alert('Error al eliminar el PDF');
    }
  };

  const handleSignatureToggle = async (docId, signatureIndex) => {
    // Optimistic update for zero-latency UI
    const updatedStudents = students.map(s => ({
      ...s,
      documents: s.documents.map(d => {
        if (d.id === docId) {
          const newSigs = [...d.signatures];
          newSigs[signatureIndex].present = !newSigs[signatureIndex].present;
          return { ...d, signatures: newSigs };
        }
        return d;
      })
    }));
    setStudents(updatedStudents);

    try {
      const doc = updatedStudents.flatMap(s => s.documents).find(d => d.id === docId);
      await axios.put(`${API_URL}/documents/${docId}/signatures`, { signatures: doc.signatures });
      // No llamamos a fetchStudents aquí para evitar parpadeos si la red es lenta, 
      // el estado ya está actualizado de forma optimista.
    } catch (error) {
      console.error('Error updating signatures:', error);
      fetchStudents(); 
      alert('Error al actualizar firmas');
    }
  };

  const handleImport = async (file) => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      await axios.post(`${API_URL}/students/import`, formData);
      alert('Importación completada con éxito');
      fetchStudents();
    } catch (error) {
      console.error('Error importing students:', error);
      alert('Error al importar el archivo Excel/CSV');
    }
  };

  const toggleExpand = (studentId) => {
    setExpandedStudent(expandedStudent === studentId ? null : studentId);
  };

  // Porcentaje solo considerando documentos que aplican (applies === true)
  const getCompletionPercentage = (student) => {
    const applicableDocs = student.documents.filter(doc => doc.applies === true);
    if (!applicableDocs.length) return 0;
    const completedDocs = applicableDocs.filter(doc =>
      doc.signatures.every(sig => sig.present)
    ).length;
    return Math.round((completedDocs / applicableDocs.length) * 100);
  };

  const getProgressColor = (percentage) => {
    if (percentage < 30) return 'bg-red-600';
    if (percentage < 70) return 'bg-yellow-500';
    return 'bg-green-600';
  };

  const getDocCompletionPercentage = (doc) => {
    if (!doc.signatures || doc.signatures.length === 0) return 100;
    const present = doc.signatures.filter(s => s.present).length;
    return Math.round((present / doc.signatures.length) * 100);
  };

  const openNewStudentModal = () => {
    setEditing(null);
    setForm({
      name: '',
      company: '',
      startDate: '',
      endDate: '',
      documents: predefinedDocs.map(doc => ({
        category: doc.name,
        signatures: doc.requiredSignatures.map(s => ({ name: s, present: false })),
        applies: !doc.optional,          // por defecto: true si no es optativo, false si es optativo
        optional: doc.optional || false
      }))
    });
    setShowModal(true);
  };

  const openEditStudentModal = (student) => {
    setEditing(student);
    setForm({
      name: student.name,
      company: student.company || '',
      startDate: student.startDate ? student.startDate.split('T')[0] : '',
      endDate: student.endDate ? student.endDate.split('T')[0] : '',
      documents: student.documents.map(doc => ({
        id: doc.id,
        category: doc.category,
        signatures: doc.signatures,
        applies: doc.applies,
        optional: doc.optional
      }))
    });
    setShowModal(true);
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6 text-indigo-700">📄 Gestión Documental</h1>

      <div className="flex gap-3 mb-6">
        <button
          onClick={openNewStudentModal}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition flex items-center gap-2 shadow-sm"
        >
          <i className="fas fa-user-plus"></i> Nuevo Alumno
        </button>
        <label className="bg-white text-indigo-600 border border-indigo-200 px-4 py-2 rounded-lg hover:bg-indigo-50 transition cursor-pointer flex items-center gap-2 shadow-sm">
          <i className="fas fa-file-import"></i> Importar Excel/CSV
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => handleImport(e.target.files[0])}
            className="hidden"
          />
        </label>
      </div>

      <div className="space-y-3">
        {students.map(student => {
          const percentage = getCompletionPercentage(student);
          const progressColor = getProgressColor(percentage);
          return (
            <div key={student.id} className="bg-white rounded-lg shadow-md overflow-hidden border border-gray-200">
              <div
                className="flex justify-between items-center p-4 cursor-pointer hover:bg-gray-50 transition"
                onClick={() => toggleExpand(student.id)}
              >
                <div className="flex items-center gap-3">
                  <i className={`fas ${expandedStudent === student.id ? 'fa-chevron-down' : 'fa-chevron-right'} text-gray-500`}></i>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800">{student.name}</h3>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-gray-200 rounded-full h-2">
                          <div className={`${progressColor} h-2 rounded-full transition-all duration-300`} style={{ width: `${percentage}%` }}></div>
                        </div>
                        <span className="text-xs font-medium text-gray-600">{percentage}% total</span>
                      </div>
                      {student.company && (
                        <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                          <i className="fas fa-building mr-1"></i>{student.company}
                        </span>
                      )}
                      {student.startDate && (
                        <span className="text-xs text-gray-500">
                          <i className="fas fa-calendar-alt mr-1"></i>
                          {new Date(student.startDate).toLocaleDateString()} - {student.endDate ? new Date(student.endDate).toLocaleDateString() : '...'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); openEditStudentModal(student); }}
                    className="text-indigo-600 hover:text-indigo-800 p-1"
                  >
                    <i className="fas fa-edit"></i>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteStudent(student.id); }}
                    className="text-red-600 hover:text-red-800 p-1"
                  >
                    <i className="fas fa-trash-alt"></i>
                  </button>
                </div>
              </div>

              {expandedStudent === student.id && (
                <div className="border-t border-gray-200 p-4 bg-gray-50">
                  {student.documents.map(doc => (
                    <div key={doc.id} className={`bg-white rounded-lg p-4 mb-3 shadow-sm border ${doc.applies ? 'border-gray-200' : 'border-gray-300 bg-gray-50'}`}>
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h4 className="font-semibold text-gray-800">{doc.category}</h4>
                          {doc.applies && (
                            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${getDocCompletionPercentage(doc) === 100 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                              {getDocCompletionPercentage(doc)}% Firmado
                            </span>
                          )}
                        </div>
                        {doc.optional && (
                          <label className="flex items-center gap-1 text-sm text-gray-600">
                            <input
                              type="checkbox"
                              checked={!doc.applies}
                              onChange={async () => {
                                // Actualizar applies en el backend
                                try {
                                  await axios.put(`${API_URL}/students/${student.id}`, {
                                    name: student.name,
                                    documents: student.documents.map(d => ({
                                      id: d.id,
                                      category: d.category,
                                      signatures: d.signatures,
                                      applies: d.id === doc.id ? !d.applies : d.applies
                                    }))
                                  });
                                  fetchStudents();
                                } catch (error) {
                                  console.error('Error updating applies:', error);
                                  alert('Error al cambiar opción de documento');
                                }
                              }}
                              className="rounded"
                            />
                            <span>No aplica</span>
                          </label>
                        )}
                      </div>

                      {doc.applies ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <p className="text-sm text-gray-600 mb-1">Firmas requeridas:</p>
                            <div className="space-y-1">
                              {doc.signatures.map((sig, idx) => (
                                <label key={idx} className="flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={sig.present}
                                    onChange={() => handleSignatureToggle(doc.id, idx)}
                                    className="rounded text-indigo-600"
                                  />
                                  <span className={sig.present ? 'text-green-600' : 'text-gray-700'}>
                                    {sig.name}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                          <div>
                            <p className="text-sm text-gray-600 mb-1">Documento PDF:</p>
                            <div className="flex items-center gap-2 flex-wrap">
                              {doc.filePath ? (
                                <>
                                  <a
                                    href={doc.filePath}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline text-sm flex items-center gap-1"
                                  >
                                    <i className="fas fa-file-pdf"></i> Ver PDF
                                  </a>
                                  <button
                                    onClick={() => handleDeletePdf(doc.id)}
                                    className="text-red-600 hover:text-red-800 text-sm p-1"
                                    title="Eliminar PDF"
                                  >
                                    <i className="fas fa-trash-alt"></i>
                                  </button>
                                </>
                              ) : (
                                <span className="text-gray-400 text-sm">No subido</span>
                              )}
                              <label className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-3 py-1 rounded text-sm cursor-pointer flex items-center gap-1">
                                <i className="fas fa-upload"></i> Subir / Reemplazar
                                <input
                                  type="file"
                                  accept="application/pdf"
                                  onChange={(e) => handleUpload(doc.id, e.target.files[0])}
                                  className="hidden"
                                />
                              </label>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-gray-500 italic text-sm py-2">
                          Este documento no aplica para este alumno (excluido del progreso).
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {students.length === 0 && (
          <div className="text-center text-gray-500 py-8">
            No hay alumnos registrados. Haz clic en "Nuevo Alumno" para comenzar.
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-xl font-bold mb-4">{editing ? 'Editar Alumno' : 'Nuevo Alumno'}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Nombre Completo</label>
                <input
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Ej: Juan Pérez"
                  className="border p-2 w-full rounded focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Empresa</label>
                <input
                  value={form.company}
                  onChange={e => setForm({ ...form, company: e.target.value })}
                  placeholder="Ej: Google, INDRA..."
                  className="border p-2 w-full rounded focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Fecha Inicio</label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={e => setForm({ ...form, startDate: e.target.value })}
                  className="border p-2 w-full rounded focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Fecha Fin</label>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={e => setForm({ ...form, endDate: e.target.value })}
                  className="border p-2 w-full rounded focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
            </div>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {form.documents.map((doc, i) => (
                <div key={i} className="border rounded p-3">
                  <div className="flex justify-between items-center">
                    <strong>{doc.category}</strong>
                    {doc.optional && (
                      <label className="flex items-center gap-1 text-sm">
                        <input
                          type="checkbox"
                          checked={!doc.applies}
                          onChange={() => {
                            const newDocs = [...form.documents];
                            newDocs[i].applies = !newDocs[i].applies;
                            setForm({ ...form, documents: newDocs });
                          }}
                          className="mr-1"
                        />
                        No aplica
                      </label>
                    )}
                  </div>
                  {doc.applies && (
                    <div className="mt-2">
                      {doc.signatures.map((sig, j) => (
                        <label key={j} className="block text-sm mt-1">
                          <input
                            type="checkbox"
                            checked={sig.present}
                            onChange={() => {
                              const newDocs = [...form.documents];
                              newDocs[i].signatures[j].present = !newDocs[i].signatures[j].present;
                              setForm({ ...form, documents: newDocs });
                            }}
                            className="mr-2"
                          />
                          {sig.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;