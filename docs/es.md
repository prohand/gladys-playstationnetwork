# PlayStation Network

Siga en Gladys quién juega en PlayStation, a qué juego, cuánto tiempo hoy, los trofeos de su
cuenta, y si su PS4 o PS5 está encendida, en reposo o apagada.

> Integración no oficial, sin relación con Sony. Sony no ofrece una API pública: la
> integración lee los mismos datos que la PlayStation App.

## Antes de empezar

Necesita:

- una cuenta de PlayStation Network (la cuenta cuyos juegos y trofeos quiere seguir);
- un ordenador con un navegador web, para obtener una vez el **token NPSSO**;
- para las consolas (opcional): una PS4 o PS5 en la misma red que Gladys.

## Obtener su token NPSSO

El NPSSO es un código de 64 caracteres que demuestra que ha iniciado sesión en su cuenta de
Sony. La integración lo usa para iniciar sesión como lo hace la PlayStation App.

1. En su navegador, vaya a [playstation.com](https://www.playstation.com/) e **inicie sesión**
   con su cuenta de PlayStation Network.
2. En el **mismo navegador**, abra
   [https://ca.account.sony.com/api/v1/ssocookie](https://ca.account.sony.com/api/v1/ssocookie).
3. La página muestra algo como `{"npsso":"Ab12...xyz"}`. Copie el valor de 64 caracteres entre
   las comillas (copiar toda la línea también funciona: la integración encuentra el valor).

Si la página muestra un error, no ha iniciado sesión: vuelva al paso 1.

> **Mantenga este token en secreto.** Quien lo tenga puede usar su cuenta. Gladys lo guarda en
> un campo secreto y la integración nunca lo escribe en el disco ni en los registros. Si cree
> que se ha filtrado, cierre la sesión en todos los dispositivos desde los ajustes de su cuenta
> PlayStation y obtenga uno nuevo.

El token dura unos **dos meses**. Cuando caduca, la pantalla de configuración de la
integración lo indica: obtenga uno nuevo de la misma forma y péguelo.

## Configuración

1. Abra la pestaña **Configuración** de la integración.
2. Pegue el token en **Token NPSSO**.
3. **Amigos a seguir** (opcional): sus ID en línea, separados por comas, 10 como máximo. Su
   configuración de privacidad debe permitirle ver su estado en línea.
4. **Dirección IP de la consola** (opcional): solo si «Buscar mis consolas» no encuentra su
   consola (vea más abajo).
5. **Intervalo de actualización**: frecuencia de lectura de PlayStation Network, 120 segundos
   por defecto (60 como mínimo: Sony limita el número de solicitudes).
6. **Zona horaria**: «Jugado hoy» vuelve a cero a medianoche en esta zona horaria
   (`Europe/Paris` por defecto).
7. Guarde y haga clic en **Probar la conexión**: muestra su ID en línea, su estado, sus
   trofeos y el estado de cada amigo.
8. Abra la pestaña **Descubrimiento** y añada los dispositivos que quiera.

## Los dispositivos

### Su cuenta PSN

Las características llegan a Gladys con su nombre en inglés (entre paréntesis abajo): puede renombrarlas al añadir el dispositivo.

| Característica                  | Valor                                             |
| ------------------------------- | ------------------------------------------------- |
| En línea (Online)               | 1 cuando está en línea en una consola, 0 si no    |
| Jugando (In game)               | 1 cuando hay un juego en marcha                   |
| Juego actual (Current game)     | el nombre del juego, `-` si no hay ninguno        |
| Plataforma (Platform)           | PS5, PS4…                                         |
| Sesión actual (Current session) | minutos desde que empezó el juego actual          |
| Jugado hoy (Played today)       | minutos de juego desde medianoche                 |
| Nivel trofeos (Trophy level)    | su nivel de trofeos                               |
| Trofeos                         | número de trofeos de platino, oro, plata y bronce |

Los trofeos se leen cada 15 minutos y al final de cada partida.

### Amigos

Cada amigo seguido es un dispositivo con las mismas características que su cuenta, salvo los
trofeos.

### Consolas

Cada consola encontrada es un dispositivo con una característica **Alimentación** (Power): 1 cuando
está encendida, 0 en reposo o apagada.

## Las consolas en la red local

Una PS4 o PS5 indica en la red local si está encendida o en reposo. Para ello:

- **PS5**: Ajustes → Sistema → Ahorro de energía → Funciones disponibles en modo de reposo →
  active **Permanecer conectado a Internet** y **Habilitar el encendido de la PS5 desde la
  red**;
- **PS4**: Ajustes → Ajustes de ahorro de energía → Establecer funciones disponibles en modo de
  reposo → active **Permanecer conectado a Internet** y **Habilitar el encendido del sistema
  PS4 desde la red**.

Haga clic después en **Buscar mis consolas** en la configuración: Gladys envía la solicitud de
descubrimiento de PlayStation en su red y muestra lo que respondió. Abra la pestaña
**Descubrimiento** para añadir la consola.

Si nada responde (otra red, un router que filtra el broadcast), dé a su consola una dirección
IP fija en su router, escríbala en **Dirección IP de la consola** y haga clic de nuevo en
**Buscar mis consolas**.

### Local o nube

Gladys muestra una insignia **local** o **nube** en la consola:

- **local**: el estado viene de la propia consola, en su red;
- **nube**: el estado viene de su presencia en PSN (en línea en la misma plataforma =
  encendida).

El interruptor **Preferir la conexión local** de la configuración elige cuál va primero. Cuando
el preferido no dice nada, se usa el otro y la insignia muestra un punto naranja con el motivo.
Sin la red local, el reposo y el apagado no se distinguen, y una consola usada por otra cuenta
se ve apagada.

La integración no puede encender una consola ni controlarla: solo lee su estado.

## Escenas

### Disparadores

- **Un juego ha empezado**: su cuenta o un amigo seguido inició un juego. Variables: ID en
  línea, juego, ID del título, plataforma.
- **Un juego ha terminado**: el juego terminó u otro lo reemplazó. Mismas variables, más la
  **duración de la sesión** en minutos.
- **Se ha conseguido un trofeo**: su cuenta consiguió nuevos trofeos. Filtro por categoría
  (platino, oro, plata, bronce). Variables: categoría, número de trofeos nuevos, total de esta
  categoría, nivel de trofeos.

Las características de los dispositivos también funcionan con los disparadores estándar de
Gladys. Ejemplos:

- _cuando «Played today» de la cuenta de mi hijo supere 120, envíame un mensaje_;
- _cuando «Power» de la PS5 pase a 1 después de las 22 h, apaga las luces del salón_.

### Acciones

- **Leer el estado de un jugador**: lee PlayStation Network ahora y devuelve en línea, jugando,
  juego, plataforma, sesión actual y jugado hoy, para las acciones siguientes de la escena (p.
  ej. una condición «solo si está jugando»).
- **Leer el estado de una consola**: encendida, en reposo (`standby`) o apagada, leído ahora.

## Widget del panel

Añada el widget **PlayStation Network** a un panel. Muestra:

- el tiempo jugado hoy y la sesión actual, y para su cuenta el nivel de trofeos y el número de
  platinos;
- quién juega a qué, con los iconos de los juegos (o el icono de su juego si no sigue a ningún
  amigo);
- su estado, plataforma y juego, y el estado de las consolas;
- un botón **Actualizar**.

En los ajustes del widget, **Jugador** elige de quién es la tarjeta (su cuenta por defecto).

## Solución de problemas

- **«El token NPSSO caducó o es incorrecto»**: obtenga uno nuevo (vea arriba). También ocurre
  tras cambiar la contraseña o cerrar la sesión en todos los dispositivos.
- **«Demasiadas solicitudes a PlayStation Network»**: aumente el intervalo de actualización.
- **Un amigo está «oculto»**: su configuración de privacidad no le permite ver su estado, o ya
  no son amigos.
- **Un amigo tiene «ninguna cuenta con este nombre»**: compruebe el ID en línea (letras,
  cifras, `-` y `_`, de 3 a 16 caracteres).
- **No se encuentra la consola**: compruebe los ajustes de ahorro de energía de arriba, y que
  está enchufada (totalmente apagada, nunca responde).
- **«Jugado hoy» parece bajo**: el tiempo se cuenta entre dos actualizaciones. Cuando Gladys o
  PlayStation Network estuvieron inaccesibles mucho tiempo, se cuenta como máximo el doble del
  intervalo de actualización para el hueco.
