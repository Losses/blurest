import typescript from 'rollup-plugin-typescript2';
import babelminify from 'rollup-plugin-babel-minify';

const config = {
    input: ['./src/index.ts'],
    output: {
        file: './build/main.js',
        format: 'umd',
        name: 'AxBlurest'
    },
    plugins: [babelminify(), typescript()]
};

export default config;
