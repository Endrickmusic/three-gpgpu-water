import './main.css'

import * as THREE from 'three';

			import { GUI } from 'three/addons/libs/lil-gui.module.min.js'

			import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js'
			import { SimplexNoise } from 'three/addons/math/SimplexNoise.js'

      import { heightmapFragmentShader } from './shaders/heightmapFragmentShader.js'
      import { waterVertexShader } from './shaders/waterVertexShader.js'

			// Texture width for simulation
			const WIDTH = 128

			// Water size in system units
			const BOUNDS = 512
			const BOUNDS_HALF = BOUNDS * 0.5

			let container
			let camera, scene, renderer
			let mouseMoved = false
			const mouseCoords = new THREE.Vector2()
			const raycaster = new THREE.Raycaster()

      let time = 0
			let waterMesh
			let meshRay
			let gpuCompute
			let heightmapVariable
			let waterUniforms

			const waterNormal = new THREE.Vector3();

			const simplex = new SimplexNoise();

			init();
			animate();

			function init() {

				container = document.createElement( 'div' )
				document.body.appendChild( container )

				camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 1, 3000 )
				camera.position.set( 0, 200, 350 )
				camera.lookAt( 0, 0, 0 )

				scene = new THREE.Scene();

				const sun = new THREE.DirectionalLight( 0xFFFFFF, 3.0 );
				sun.position.set( 300, 400, 175 );
				scene.add( sun );

				const sun2 = new THREE.DirectionalLight( 0x40A040, 2.0 );
				sun2.position.set( - 100, 350, - 200 );
				scene.add( sun2 );

				renderer = new THREE.WebGLRenderer();
				renderer.setPixelRatio( window.devicePixelRatio );
				renderer.setSize( window.innerWidth, window.innerHeight );
				container.appendChild( renderer.domElement );


				container.style.touchAction = 'none'
				container.addEventListener( 'pointermove', onPointerMove )

				document.addEventListener( 'keydown', function ( event ) {

					// W Pressed: Toggle wireframe
					if ( event.keyCode === 87 ) {

						waterMesh.material.wireframe = ! waterMesh.material.wireframe;
						waterMesh.material.needsUpdate = true;

					}

				} )

				window.addEventListener( 'resize', onWindowResize )

				const gui = new GUI()

				const effectController = {
					mouseSize: 80.0,
					viscosity: 0.995,
				}

				const valuesChanger = function () {

					heightmapVariable.material.uniforms[ 'mouseSize' ].value = effectController.mouseSize
					heightmapVariable.material.uniforms[ 'viscosityConstant' ].value = effectController.viscosity

        }  

				gui.add( effectController, 'mouseSize', 1.0, 100.0, 1.0 ).onChange( valuesChanger )
				gui.add( effectController, 'viscosity', 0.9, 0.999, 0.001 ).onChange( valuesChanger )
				

				initWater()

				valuesChanger()

      }


			function initWater() {

				const materialColor = 0x0040C0;

				const geometry = new THREE.PlaneGeometry( BOUNDS, BOUNDS, WIDTH - 1, WIDTH - 1 )

				// material: make a THREE.ShaderMaterial clone of THREE.MeshPhongMaterial, with customized vertex shader
				const material = new THREE.ShaderMaterial( {
					uniforms: THREE.UniformsUtils.merge( [
						THREE.ShaderLib[ 'phong' ].uniforms,
						{
							'heightmap': { value: null }
						}
					] ),
					vertexShader: waterVertexShader,
					fragmentShader: THREE.ShaderChunk[ 'meshphong_frag' ]

				} );

				material.lights = true;

				// Material attributes from THREE.MeshPhongMaterial
				// Sets the uniforms with the material values
				material.uniforms[ 'diffuse' ].value = new THREE.Color( materialColor );
				material.uniforms[ 'specular' ].value = new THREE.Color( 0x111111 );
				material.uniforms[ 'shininess' ].value = Math.max( 50, 1e-4 );
				material.uniforms[ 'opacity' ].value = material.opacity;

				// Defines
				material.defines.WIDTH = WIDTH.toFixed( 1 );
				material.defines.BOUNDS = BOUNDS.toFixed( 1 );

				waterUniforms = material.uniforms;

				waterMesh = new THREE.Mesh( geometry, material );
				waterMesh.rotation.x = - Math.PI / 2;
				waterMesh.matrixAutoUpdate = false;
				waterMesh.updateMatrix();

				scene.add( waterMesh );

				// THREE.Mesh just for mouse raycasting
				const geometryRay = new THREE.PlaneGeometry( BOUNDS, BOUNDS, 1, 1 );
				meshRay = new THREE.Mesh( geometryRay, new THREE.MeshBasicMaterial( { color: 0xFFFFFF, visible: false } ) );
				meshRay.rotation.x = - Math.PI / 2;
				meshRay.matrixAutoUpdate = false;
				meshRay.updateMatrix();
				scene.add( meshRay );


				// Creates the gpu computation class and sets it up

				gpuCompute = new GPUComputationRenderer( WIDTH, WIDTH, renderer );

				if ( renderer.capabilities.isWebGL2 === false ) {

					gpuCompute.setDataType( THREE.HalfFloatType );

				}

				const heightmap0 = gpuCompute.createTexture();

				fillTexture( heightmap0 );

				heightmapVariable = gpuCompute.addVariable( 'heightmap', heightmapFragmentShader, heightmap0 );

				gpuCompute.setVariableDependencies( heightmapVariable, [ heightmapVariable ] );

				heightmapVariable.material.uniforms[ 'mousePos' ] = { value: new THREE.Vector2( 10000, 10000 ) };
				heightmapVariable.material.uniforms[ 'mouseSize' ] = { value: 20.0 };
				heightmapVariable.material.uniforms[ 'viscosityConstant' ] = { value: 0.98 };
				heightmapVariable.material.uniforms[ 'heightCompensation' ] = { value: 0 };
				heightmapVariable.material.uniforms[ 'uTime' ] = { value: 0 };
				heightmapVariable.material.defines.BOUNDS = BOUNDS.toFixed( 1 );

				const error = gpuCompute.init();
				if ( error !== null ) {

				    console.error( error );

				}

			}

			function fillTexture( texture ) {

				const waterMaxHeight = 15;

				function noise( x, y ) {

					let multR = waterMaxHeight;
					let mult = 0.025;
					let r = 0;
					for ( let i = 0; i < 15; i ++ ) {

						r += multR * simplex.noise( x * mult, y * mult);
						multR *= 0.53 + 0.025 * i;
						mult *= 1.25;

					}

					return r;

				}

				const pixels = texture.image.data;

				let p = 0;
				for ( let j = 0; j < WIDTH; j ++ ) {

					for ( let i = 0; i < WIDTH; i ++ ) {

						const x = i * 128 / WIDTH;
						const y = j * 128 / WIDTH;

						pixels[ p + 0 ] = noise( x, y );
						pixels[ p + 1 ] = pixels[ p + 0 ];
						pixels[ p + 2 ] = 0;
						pixels[ p + 3 ] = 1;

						p += 4;

					}

				}
			}

			function onWindowResize() {

				camera.aspect = window.innerWidth / window.innerHeight;
				camera.updateProjectionMatrix();

				renderer.setSize( window.innerWidth, window.innerHeight );

			}

			function setMouseCoords( x, y ) {

				mouseCoords.set( ( x / renderer.domElement.clientWidth ) * 2 - 1, - ( y / renderer.domElement.clientHeight ) * 2 + 1 );
				mouseMoved = true;

			}

			function onPointerMove( event ) {

				if ( event.isPrimary === false ) return;

				setMouseCoords( event.clientX, event.clientY );

			}

			function animate() {

				requestAnimationFrame( animate )

        time += 0.04
        heightmapVariable.material.uniforms[ 'uTime' ].value = time
        // console.log( heightmapVariable.material.uniforms[ 'uTime' ].value)

				render();

			}

			function render() {

				// Set uniforms: mouse interaction
				const uniforms = heightmapVariable.material.uniforms;
				if ( mouseMoved ) {

					raycaster.setFromCamera( mouseCoords, camera );

					const intersects = raycaster.intersectObject( meshRay );

					if ( intersects.length > 0 ) {

						const point = intersects[ 0 ].point;
						uniforms[ 'mousePos' ].value.set( point.x, point.z );

					} else {

						uniforms[ 'mousePos' ].value.set( 10000, 10000 );

					}

					mouseMoved = false;

				} else {

					uniforms[ 'mousePos' ].value.set( 10000, 10000 );

				}
        

				// Do the gpu computation
				gpuCompute.compute();

				// Get compute output in custom uniform
				waterUniforms[ 'heightmap' ].value = gpuCompute.getCurrentRenderTarget( heightmapVariable ).texture;

				// Render
				renderer.render( scene, camera );

			}


