import { CRStruct } from './dist/index.js'

const obj = new CRStruct({
  givenName: '',
  nested: new CRStruct({ familyName: '' }).toJSON(),
})

obj.givenName = 'Jori'

console.log(obj.givenName)

for (const key in obj) console.log(key)
for (const [key, val] of obj) console.log(key, ':', val)
