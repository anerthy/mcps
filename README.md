---
Course: Arquitectura de Software Moderno
Team: [Andrés Mejías, Bryan Montero]
---

# MCP en el Mundo Real: IA como Copiloto de Desarrollo

## ¿De qué trata?

La presentación expone cómo el equipo integró el Model Context Protocol (MCP) en cada capa de un stack de desarrollo real, convirtiendo a la IA en un copiloto activo del día a día. El proyecto se llama Plataforma ACME y consiste en una aplicación con frontend, API de productos, base de datos, y un sistema de identidad, donde cada componente tiene su propio MCP que permite operarlo mediante lenguaje natural desde herramientas como Claude o Cursor.

El argumento central es que el desarrollo tradicional tiene una fricción enorme: el diseño vive separado del código, la configuración de herramientas como Keycloak es manual y propensa a errores, la documentación de APIs nace desactualizada, y para usar la API hay que conocerla de memoria. Los MCPs resuelven cada uno de esos problemas creando un puente directo entre el modelo de IA y cada sistema.

El caso más sofisticado es el ACME MCP, un servidor
MCP custom que no solo conecta con la API sino que expone herramientas dinámicas según el rol del usuario autenticado: un admin puede hacer todo el CRUD, un editor no puede eliminar ni crear, y un consultor solo puede leer. Esto demuestra que se puede ser flexible con la IA y estricto con los permisos al mismo tiempo.

El proceso de desarrollo también está cubierto: se usa SDD con formato Gherkin, donde la especificación guía el código y los tests. Se menciona una integración futura con SonarQube como evolución natural del sistema.

La presentación cierra con una reflexión honesta sobre el costo de trabajar con modelos de pago hoy, y por qué igual vale la pena apostar a esta forma de trabajar.

Repositorio: https://github.com/anerthy/mcps.git
