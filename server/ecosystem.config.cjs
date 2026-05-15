// C:\Users\Administrador\Desktop\ZENTRIK_operario\RCN_Remallado\server\ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'remalle',
      cwd: 'C:/Users/Administrador/Desktop/ZENTRIK_operario/RCN_Remallado/server',
      script: 'src/server.js',
      // Opcional: si tu package.json tiene "type":"module", no hace falta nada extra
      instances: 1,
      autorestart: true,
      watch: false,                 // en producción mejor sin watch
      max_memory_restart: '300M',
      time: true,                   // muestra timestamp en logs
      env: {
        NODE_ENV: 'production',     // tu .env seguirá funcionando
        PORT: 3001
      }
    }
  ]
};
