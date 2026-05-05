import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import emailjs from '@emailjs/browser';

const supabase = createClient(
  'https://toivxmkbdbpwplpavcde.supabase.co', 
  'sb_publishable_nr3889gvi7m2aw5OnpLudg_S4Bp57bu',
  { auth: { persistSession: false } }
);

const CRM_Oralhome_Oficial = () => {
  const [aliados, setAliados] = useState([]);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [expandidoId, setExpandidoId] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [errorSupabase, setErrorSupabase] = useState(null);
  
  const [nuevo, setNuevo] = useState({
    Compañia: '', 
    Actividad_comercial: '', 
    Producto: '', 
    Responsable_cliente: '', 
    Telefono: '', 
    email_cliente: '', 
    Mes_renovacion: 'Enero',
    actividades: [{ fecha: '', nota: '', cumplida: false }], 
    tarifa: { 2017: 0, 2018: 0, 2019: 0, 2020: 0, 2021: 0, 2022: 0, 2023: 0, 2024: 0, 2025: 0, 2026: 0 }
  });

  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const formatoCOP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

  useEffect(() => { 
    fetchAliados(); 
  }, []);

  const fetchAliados = async () => {
    try {
      const { data, error } = await supabase.from('Aliados').select('*');
      if (error) throw error;
      if (data) {
        const lista = data.reverse();
        setAliados(lista);
        verificarAlertasProximas(lista);
      }
    } catch (err) {
      setErrorSupabase(err.message);
    }
  };

  const calcularDiasLaborales = (fechaInicio, fechaFin) => {
    let count = 0;
    let fechaTemporal = new Date(fechaInicio.getTime());
    while (fechaTemporal < fechaFin) {
      fechaTemporal.setDate(fechaTemporal.getDate() + 1);
      const dia = fechaTemporal.getDay();
      if (dia !== 0 && dia !== 6) count++;
    }
    return count;
  };

  const verificarAlertasProximas = (datos) => {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    datos.forEach(aliado => {
      // 1. ALERTAS DE RENOVACIÓN (1 Y 2 MESES)
      const mesActualIdx = hoy.getMonth();
      const mesRenIdx = meses.indexOf(aliado.Mes_renovacion);
      if (mesRenIdx !== -1) {
        const diffMeses = (mesRenIdx - mesActualIdx + 12) % 12;
        if (diffMeses === 2 || diffMeses === 1) {
          const tAlerta = diffMeses === 2 ? "2 meses" : "1 mes";
          enviarAlertaEmail(aliado, `proximamente se cumplirá el mes de renovacion en el mes ${aliado.Mes_renovacion}`, tAlerta);
        }
      }

      // 2. ALERTAS DE CRONOGRAMA (8 DÍAS HÁBILES) - Lógica de precisión
      aliado.actividades?.forEach(act => {
        if (!act.cumplida && act.fecha) {
          const [anio, mes, dia] = act.fecha.split('-').map(Number);
          const fechaAct = new Date(anio, mes - 1, dia);
          fechaAct.setHours(0, 0, 0, 0);

          if (fechaAct > hoy) {
            const habiles = calcularDiasLaborales(hoy, fechaAct);
            // Si hoy es 04-05 y la fecha es 14-05, habiles será exactamente 8
            if (habiles === 8) {
              enviarAlertaEmail(aliado, `se tiene una actividad comercial para la fecha ${act.fecha}`, "8 días hábiles");
            }
          }
        }
      });
    });
  };

  const enviarAlertaEmail = (datos, mensajeDinamico, tiempoAlerta) => {
    const templateParams = {
      to_email: 'coordinadordeservicio@oralhome.com.co',
      compañia: datos.Compañia,
      producto: datos.Producto,
      mes_vence: datos.Mes_renovacion,
      tiempo_alerta: tiempoAlerta,
      responsable: "NATALIA SALAZAR", 
      contacto: datos.Telefono || "No registrado",
      detalles_alerta: mensajeDinamico 
    };

    // RECUERDA: Coloca aquí tus IDs reales de EmailJS
    emailjs.send(
      'TU_SERVICE_ID', 
      'TU_TEMPLATE_ID', 
      templateParams, 
      'TU_PUBLIC_KEY'
    )
    .then(() => console.log(`📧 Alerta enviada para ${datos.Compañia}`))
    .catch((err) => console.error("❌ Error EmailJS:", err));
  };

  const guardarOActualizar = async (e) => {
    e.preventDefault();
    if (cargando) return;
    setCargando(true);
    try {
      const { Id, id, created_at, ...datosLimpios } = nuevo;
      if (editandoId) {
        await supabase.from('Aliados').update(datosLimpios).eq('Id', editandoId);
      } else {
        await supabase.from('Aliados').insert([datosLimpios]);
      }
      resetForm();
      fetchAliados();
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setCargando(false);
    }
  };

  const agregarFilaActividad = () => {
    setNuevo({ ...nuevo, actividades: [...nuevo.actividades, { fecha: '', nota: '', cumplida: false }] });
  };

  const actualizarActividad = (index, campo, valor) => {
    const nuevas = [...nuevo.actividades];
    nuevas[index][campo] = valor;
    setNuevo({ ...nuevo, actividades: nuevas });
  };

  const prepararEdicion = (aliado) => {
    const idParaEditar = aliado.Id || aliado.id;
    setEditandoId(idParaEditar);
    setNuevo({ ...aliado, actividades: aliado.actividades || [{ fecha: '', nota: '', cumplida: false }] });
    setMostrarForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetForm = () => {
    setNuevo({ 
      Compañia: '', Actividad_comercial: '', Producto: '', Responsable_cliente: '', Telefono: '', email_cliente: '', Mes_renovacion: 'Enero',
      actividades: [{ fecha: '', nota: '', cumplida: false }],
      tarifa: { 2017: 0, 2018: 0, 2019: 0, 2020: 0, 2021: 0, 2022: 0, 2023: 0, 2024: 0, 2025: 0, 2026: 0 } 
    });
    setEditandoId(null);
    setMostrarForm(false);
  };

  const exportarAExcel = () => {
    if (aliados.length === 0) return;
    const cabeceras = ["Compañia", "Producto", "Mes Renovacion", "Responsable", "Telefono", "Email", "Proxima Actividad"];
    const filas = aliados.map(a => [`"${a.Compañia}"`, `"${a.Producto}"`, `"${a.Mes_renovacion}"`, `"${a.Responsable_cliente}"`, `"${a.Telefono}"`, `"${a.email_cliente}"`, `"${a.actividades?.[0]?.fecha || 'N/A'}"`].join(","));
    const blob = new Blob(["\uFEFF" + [cabeceras.join(","), ...filas].join("\n")], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `CRM_Oralhome_Export.csv`;
    link.click();
  };

  const filtrados = aliados.filter(a => (a.Compañia||'').toLowerCase().includes(busqueda.toLowerCase()) || (a.Producto||'').toLowerCase().includes(busqueda.toLowerCase()));

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900">
      {/* Header Corporativo */}
      <div className="max-w-6xl mx-auto bg-[#0f172a] rounded-2xl p-6 mb-8 flex flex-col sm:flex-row justify-between items-center shadow-xl border-b-4 border-blue-600 gap-4">
        <h1 className="font-black text-white text-xl uppercase tracking-tighter">🏢 CRM ALIADOS - COORDINACIÓN</h1>
        <div className="flex gap-3">
          <button onClick={exportarAExcel} className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold text-xs uppercase shadow-lg hover:bg-emerald-700 transition-all">📊 EXPORTAR</button>
          <button onClick={() => { if(mostrarForm) resetForm(); setMostrarForm(!mostrarForm); }} className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold text-xs uppercase shadow-lg hover:bg-blue-700 transition-all">
            {mostrarForm ? 'CERRAR' : '+ NUEVO CONVENIO'}
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto">
        {!mostrarForm && (
          <input type="text" placeholder="Buscar aliado o producto..." className="w-full p-5 mb-10 rounded-2xl shadow-sm border-2 border-transparent focus:border-blue-500 outline-none font-bold bg-white" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        )}

        {mostrarForm && (
          <form onSubmit={guardarOActualizar} className="bg-white p-8 rounded-[2rem] shadow-xl mb-10 animate-in fade-in zoom-in">
            <h2 className="text-xl font-black mb-8 uppercase text-blue-600">{editandoId ? '📝 Editando Registro' : '🆕 Nuevo Registro'}</h2>
            
            {/* Campos Principales */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              <input required placeholder="Compañía" className="p-4 bg-slate-50 rounded-2xl border outline-none font-bold" type="text" value={nuevo.Compañia} onChange={e => setNuevo({...nuevo, Compañia: e.target.value})} />
              <input placeholder="Producto" className="p-4 bg-slate-50 rounded-2xl border outline-none font-bold" type="text" value={nuevo.Producto} onChange={e => setNuevo({...nuevo, Producto: e.target.value})} />
              <select className="p-4 bg-slate-50 rounded-2xl border outline-none font-bold" value={nuevo.Mes_renovacion} onChange={e => setNuevo({...nuevo, Mes_renovacion: e.target.value})}>{meses.map(m => <option key={m} value={m}>{m}</option>)}</select>
              <input placeholder="Responsable del Cliente" className="p-4 bg-slate-50 rounded-2xl border outline-none" type="text" value={nuevo.Responsable_cliente} onChange={e => setNuevo({...nuevo, Responsable_cliente: e.target.value})} />
              <input placeholder="Teléfono / Celular" className="p-4 bg-slate-50 rounded-2xl border outline-none font-bold" type="text" value={nuevo.Telefono} onChange={e => setNuevo({...nuevo, Telefono: e.target.value})} />
              <input placeholder="Email de contacto" className="p-4 bg-slate-50 rounded-2xl border outline-none" type="email" value={nuevo.email_cliente} onChange={e => setNuevo({...nuevo, email_cliente: e.target.value})} />
            </div>

            {/* Cronograma */}
            <div className="mb-8 p-6 bg-blue-50 rounded-3xl border border-blue-100">
              <h3 className="font-black text-blue-900 text-xs uppercase mb-4">📅 Cronograma de Actividades (Alerta 8 días hábiles antes)</h3>
              {nuevo.actividades.map((act, idx) => (
                <div key={idx} className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3 items-center">
                  <input type="date" className="p-3 rounded-xl border-none shadow-sm text-xs" value={act.fecha} onChange={e => actualizarActividad(idx, 'fecha', e.target.value)} />
                  <input placeholder="Nota..." className="p-3 rounded-xl border-none shadow-sm text-xs" type="text" value={act.nota} onChange={e => actualizarActividad(idx, 'nota', e.target.value)} />
                  <label className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase">
                    <input type="checkbox" checked={act.cumplida} onChange={e => actualizarActividad(idx, 'cumplida', e.target.checked)} /> Completada
                  </label>
                </div>
              ))}
              <button type="button" onClick={agregarFilaActividad} className="text-blue-600 font-bold text-[10px] uppercase mt-2">+ Agregar Actividad</button>
            </div>

            {/* Tarifas Históricas */}
            <div className="mb-8 p-6 bg-slate-50 rounded-3xl border border-dashed border-slate-200">
              <h3 className="font-black text-slate-400 text-[9px] uppercase mb-4 text-center">Evolución de Tarifas (COP)</h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-6 text-center">
                {Object.keys(nuevo.tarifa).sort().map(año => (
                  <div key={año}>
                    <label className="text-[10px] font-bold text-slate-400 mb-1 block uppercase">{año}</label>
                    <input type="number" className="w-full bg-transparent text-center font-black text-blue-600 outline-none text-sm" value={nuevo.tarifa[año]} onChange={e => setNuevo({...nuevo, tarifa: { ...nuevo.tarifa, [año]: parseInt(e.target.value) || 0 }})} />
                  </div>
                ))}
              </div>
            </div>

            <button disabled={cargando} className="w-full bg-[#059669] text-white font-black py-5 rounded-2xl shadow-lg uppercase tracking-widest hover:bg-emerald-700 transition-all">
              {cargando ? 'PROCESANDO...' : 'GUARDAR Y ACTIVAR ALERTAS'}
            </button>
          </form>
        )}

        {/* Lista de Aliados */}
        <div className="space-y-4">
          {filtrados.map(aliado => {
            const idActual = aliado.Id || aliado.id;
            return (
              <div key={idActual} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-md transition-shadow">
                <div className="p-6 flex justify-between items-center cursor-pointer" onClick={() => setExpandidoId(expandidoId === idActual ? null : idActual)}>
                  <div>
                    <h3 className="text-lg font-black uppercase text-slate-800 leading-none mb-1">{aliado.Compañia}</h3>
                    <p className="text-blue-500 font-bold text-[10px] uppercase">{aliado.Producto} — Renovación: {aliado.Mes_renovacion}</p>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[9px] font-black text-slate-400 uppercase">Próxima Actividad:</span>
                    <span className="text-xs font-bold text-orange-600">{aliado.actividades?.find(a => !a.cumplida)?.fecha || 'Sin fecha'}</span>
                  </div>
                </div>

                {expandidoId === idActual && (
                  <div className="p-6 bg-slate-50 border-t border-slate-100 animate-in slide-in-from-top-2">
                    {/* Grid Tarifas en Detalle */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 md:grid-cols-10 gap-2 mb-6">
                      {Object.keys(aliado.tarifa || {}).sort().map(año => (
                        <div key={año} className="text-center p-2 bg-white rounded-xl border border-slate-200">
                          <p className="text-[8px] font-bold text-slate-400 uppercase">{año}</p>
                          <p className="text-[10px] font-black text-blue-800">{formatoCOP.format(aliado.tarifa[año] || 0)}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-col md:flex-row justify-between items-end gap-4 border-t pt-5">
                      <div className="text-xs space-y-1.5 w-full">
                        <p><span className="text-slate-400 font-bold uppercase text-[9px]">Responsable:</span> <span className="font-bold">{aliado.Responsable_cliente}</span></p>
                        <p><span className="text-slate-400 font-bold uppercase text-[9px]">Teléfono:</span> <span className="font-bold text-blue-600">{aliado.Telefono || 'N/A'}</span></p>
                        <p><span className="text-slate-400 font-bold uppercase text-[9px]">Email:</span> <span className="font-bold">{aliado.email_cliente}</span></p>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); prepararEdicion(aliado); }} className="w-full md:w-auto bg-[#0f172a] text-white px-10 py-4 rounded-xl text-[10px] font-black uppercase shadow-lg">✏️ MODIFICAR</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default CRM_Oralhome_Oficial;
