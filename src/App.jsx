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

  useEffect(() => { fetchAliados(); }, []);

  const fetchAliados = async () => {
    try {
      const { data, error } = await supabase.from('Aliados').select('*');
      if (error) throw error;
      if (data) {
        const lista = data.reverse();
        setAliados(lista);
        verificarAlertasProximas(lista);
      }
    } catch (err) { setErrorSupabase(err.message); }
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
      const mesActualIdx = hoy.getMonth();
      const mesRenIdx = meses.indexOf(aliado.Mes_renovacion);
      if (mesRenIdx !== -1) {
        const diffMeses = (mesRenIdx - mesActualIdx + 12) % 12;
        if (diffMeses === 2 || diffMeses === 1) {
          enviarAlertaEmail(aliado, `proximamente se cumplirá el mes de renovacion en el mes ${aliado.Mes_renovacion}`, diffMeses === 2 ? "2 meses" : "1 mes");
        }
      }

      aliado.actividades?.forEach(act => {
        if (!act.cumplida && act.fecha) {
          const [anio, mes, dia] = act.fecha.split('-').map(Number);
          const fechaAct = new Date(anio, mes - 1, dia);
          fechaAct.setHours(0, 0, 0, 0);
          if (fechaAct > hoy && calcularDiasLaborales(hoy, fechaAct) === 8) {
            enviarAlertaEmail(aliado, `se tiene una actividad comercial para la fecha ${act.fecha}`, "8 días hábiles");
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
      // CAMBIO AQUÍ: Ahora toma el nombre del registro, no uno fijo
      responsable: datos.Responsable_cliente || "Responsable no asignado", 
      contacto: datos.Telefono || "No registrado",
      detalles_alerta: mensajeDinamico 
    };
    emailjs.send('service_tm5z0fb', 'template_bjx6dra', templateParams, '5RQueOaG3mbaioYG3');
  };

  const guardarOActualizar = async (e) => {
    e.preventDefault();
    if (cargando) return;
    setCargando(true);
    try {
      const { Id, id, created_at, ...datosLimpios } = nuevo;
      if (editandoId) { await supabase.from('Aliados').update(datosLimpios).eq('Id', editandoId); }
      else { await supabase.from('Aliados').insert([datosLimpios]); }
      resetForm(); fetchAliados();
    } catch (err) { alert(err.message); } finally { setCargando(false); }
  };

  const agregarFilaActividad = () => setNuevo({ ...nuevo, actividades: [...nuevo.actividades, { fecha: '', nota: '', cumplida: false }] });
  const actualizarActividad = (index, campo, valor) => {
    const nuevas = [...nuevo.actividades]; nuevas[index][campo] = valor;
    setNuevo({ ...nuevo, actividades: nuevas });
  };

  const prepararEdicion = (aliado) => {
    setEditandoId(aliado.Id || aliado.id);
    setNuevo({ ...aliado, actividades: aliado.actividades || [{ fecha: '', nota: '', cumplida: false }] });
    setMostrarForm(true);
  };

  const resetForm = () => {
    setNuevo({ 
      Compañia: '', Actividad_comercial: '', Producto: '', Responsable_cliente: '', Telefono: '', email_cliente: '', Mes_renovacion: 'Enero',
      actividades: [{ fecha: '', nota: '', cumplida: false }],
      tarifa: { 2017: 0, 2018: 0, 2019: 0, 2020: 0, 2021: 0, 2022: 0, 2023: 0, 2024: 0, 2025: 0, 2026: 0 } 
    });
    setEditandoId(null); setMostrarForm(false);
  };

  const exportarAExcel = () => {
    const cabeceras = ["Compañia", "Producto", "Mes Renovacion", "Responsable", "Telefono", "Email"];
    const filas = aliados.map(a => [`"${a.Compañia}"`, `"${a.Producto}"`, `"${a.Mes_renovacion}"`, `"${a.Responsable_cliente}"`, `"${a.Telefono}"`, `"${a.email_cliente}"`].join(","));
    const blob = new Blob(["\uFEFF" + [cabeceras.join(","), ...filas].join("\n")], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `CRM_Oralhome.csv`; link.click();
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto bg-[#0a0f1e] rounded-3xl p-8 mb-10 flex flex-col md:flex-row justify-between items-center shadow-2xl border-b-[6px] border-blue-500">
        
        <div className="flex-1 hidden lg:block">
          <span className="text-blue-500 font-black text-[10px] uppercase tracking-[0.3em] block mb-1">SISTEMA DE GESTIÓN</span>
          <h1 className="text-white font-light text-2xl">CRM <span className="font-black text-blue-400">ALIADOS</span></h1>
        </div>

        {/* LOGO CORREGIDO: Llamada al archivo local que tú tienes */}
        <div className="flex-1 flex justify-center py-4 md:py-0">
          <img 
            src="/LOGO-ORAL-HOME SIN FONDO.png" 
            alt="Oralhome" 
            className="h-20 w-auto object-contain"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        </div>

        <div className="flex-1 flex justify-end gap-4 w-full md:w-auto">
          <button onClick={exportarAExcel} className="bg-slate-800/50 text-white px-6 py-3 rounded-2xl font-bold text-[10px] uppercase border border-slate-700">📊 EXPORTAR</button>
          <button onClick={() => { if(mostrarForm) resetForm(); setMostrarForm(!mostrarForm); }} className="bg-blue-600 text-white px-8 py-3 rounded-2xl font-black text-[10px] uppercase">
            {mostrarForm ? 'CERRAR' : '+ NUEVO CONVENIO'}
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto">
        {!mostrarForm && (
          <input type="text" placeholder="Buscar aliado o producto..." className="w-full p-6 mb-12 rounded-3xl shadow-sm border-none outline-none font-medium bg-white text-lg" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        )}

        {mostrarForm && (
          <form onSubmit={guardarOActualizar} className="bg-white p-10 rounded-[3rem] shadow-2xl mb-12 border border-slate-100">
            <h2 className="text-2xl font-black uppercase text-slate-800 mb-10">{editandoId ? 'Editar Aliado' : 'Registro de Nuevo Aliado'}</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-10">
              <input required placeholder="Compañía" className="p-5 bg-slate-50 rounded-2xl border-none outline-none font-bold" type="text" value={nuevo.Compañia} onChange={e => setNuevo({...nuevo, Compañia: e.target.value})} />
              <input placeholder="Producto" className="p-5 bg-slate-50 rounded-2xl border-none outline-none font-bold" type="text" value={nuevo.Producto} onChange={e => setNuevo({...nuevo, Producto: e.target.value})} />
              <select className="p-5 bg-slate-50 rounded-2xl border-none outline-none font-bold" value={nuevo.Mes_renovacion} onChange={e => setNuevo({...nuevo, Mes_renovacion: e.target.value})}>{meses.map(m => <option key={m} value={m}>{m}</option>)}</select>
              <input placeholder="Responsable" className="p-5 bg-slate-50 rounded-2xl border-none" type="text" value={nuevo.Responsable_cliente} onChange={e => setNuevo({...nuevo, Responsable_cliente: e.target.value})} />
              <input placeholder="Teléfono" className="p-5 bg-slate-50 rounded-2xl border-none font-bold" type="text" value={nuevo.Telefono} onChange={e => setNuevo({...nuevo, Telefono: e.target.value})} />
              <input placeholder="Email" className="p-5 bg-slate-50 rounded-2xl border-none" type="email" value={nuevo.email_cliente} onChange={e => setNuevo({...nuevo, email_cliente: e.target.value})} />
            </div>

            <div className="mb-10 p-8 bg-blue-50/50 rounded-[2.5rem] border border-blue-100">
              <h3 className="font-black text-blue-900 text-xs uppercase mb-6">📅 Cronograma de Actividades</h3>
              {nuevo.actividades.map((act, idx) => (
                <div key={idx} className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-4 items-center bg-white p-4 rounded-2xl">
                  <input type="date" className="p-3 border-none text-xs font-bold" value={act.fecha} onChange={e => actualizarActividad(idx, 'fecha', e.target.value)} />
                  <input placeholder="Nota..." className="p-3 border-none text-xs" type="text" value={act.nota} onChange={e => actualizarActividad(idx, 'nota', e.target.value)} />
                  <label className="flex items-center gap-3 text-[10px] font-black text-slate-400 uppercase">
                    <input type="checkbox" checked={act.cumplida} onChange={e => actualizarActividad(idx, 'cumplida', e.target.checked)} /> Completada
                  </label>
                </div>
              ))}
              <button type="button" onClick={agregarFilaActividad} className="text-blue-600 font-black text-[10px] uppercase mt-4">+ Añadir Fecha</button>
            </div>

            <div className="mb-10 p-8 bg-slate-50 rounded-[2.5rem] border-2 border-dashed border-slate-200 text-center">
              <h3 className="font-black text-slate-400 text-[9px] uppercase mb-6">Evolución de Tarifas (COP)</h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-8">
                {Object.keys(nuevo.tarifa).sort().map(año => (
                  <div key={año}>
                    <label className="text-[10px] font-black text-slate-300 mb-2 block uppercase">{año}</label>
                    <input type="number" className="w-full bg-transparent text-center font-black text-slate-700 outline-none" value={nuevo.tarifa[año]} onChange={e => setNuevo({...nuevo, tarifa: { ...nuevo.tarifa, [año]: parseInt(e.target.value) || 0 }})} />
                  </div>
                ))}
              </div>
            </div>

            <button disabled={cargando} className="w-full bg-emerald-600 text-white font-black py-6 rounded-3xl shadow-xl uppercase tracking-widest">
              {cargando ? 'Guardando...' : 'Finalizar y Guardar'}
            </button>
          </form>
        )}

        <div className="grid grid-cols-1 gap-6">
          {aliados.filter(a => (a.Compañia||'').toLowerCase().includes(busqueda.toLowerCase())).map(aliado => {
            const id = aliado.Id || aliado.id;
            const proxima = aliado.actividades?.find(a => !a.cumplida);
            return (
              <div key={id} className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
                <div className="p-8 flex justify-between items-center cursor-pointer" onClick={() => setExpandidoId(expandidoId === id ? null : id)}>
                  <div className="flex items-center gap-6">
                    <div className="h-16 w-16 bg-blue-50 rounded-2xl flex items-center justify-center text-2xl font-bold">🏢</div>
                    <div>
                      <h3 className="text-xl font-black uppercase text-slate-800 mb-1">{aliado.Compañia}</h3>
                      <span className="bg-blue-100 text-blue-700 text-[10px] font-black px-3 py-1 rounded-full uppercase">{aliado.Producto}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] font-black text-slate-300 uppercase">Próxima Fecha</p>
                    <p className="text-sm font-black text-orange-500">{proxima?.fecha || 'Al día'}</p>
                  </div>
                </div>

                {expandidoId === id && (
                  <div className="px-8 pb-8 bg-slate-50/30 border-t border-slate-50">
                    <div className="grid grid-cols-2 sm:grid-cols-5 md:grid-cols-10 gap-3 py-8">
                      {Object.keys(aliado.tarifa || {}).sort().map(año => (
                        <div key={año} className="bg-white p-3 rounded-2xl border border-slate-100 text-center shadow-sm">
                          <p className="text-[8px] font-black text-slate-300 uppercase mb-1">{año}</p>
                          <p className="text-[11px] font-black text-blue-600">{formatoCOP.format(aliado.tarifa[año] || 0)}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-col md:flex-row justify-between items-center gap-6 bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                      <div className="flex flex-wrap gap-8 text-[11px]">
                        <div><p className="text-slate-300 font-black uppercase">Responsable</p><p className="font-bold">{aliado.Responsable_cliente}</p></div>
                        <div><p className="text-slate-300 font-black uppercase">Teléfono</p><p className="font-black text-blue-600">{aliado.Telefono}</p></div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); prepararEdicion(aliado); }} className="bg-slate-900 text-white px-10 py-4 rounded-2xl text-[10px] font-black uppercase">✏️ Editar</button>
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