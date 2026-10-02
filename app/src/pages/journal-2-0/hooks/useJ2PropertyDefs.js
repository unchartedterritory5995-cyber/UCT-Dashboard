/** Wave E — property definitions SWR hook (built-ins + user-defined). */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2PropertyDefs() {
  const url = '/api/j2/property-defs'
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  })
  const propertyDefs = data?.propertyDefs ?? []

  // Wave 11 (lane 11B): `config` carries a formula's or a rollup's settings.
  const create = async (name, type, options, config) => {
    const res = await fetch(url, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, ...(options ? { options } : {}), ...(config ? { config } : {}) }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail || `${res.status}`)
    }
    const body = await res.json()
    await mutate()
    return body.propertyDef
  }
  const rename = async (id, name) => {
    const res = await fetch(`${url}/${id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail || `${res.status}`)
    }
    await mutate()
  }
  const updateOptions = async (id, options) => {
    const res = await fetch(`${url}/${id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail || `${res.status}`)
    }
    await mutate()
  }
  /** Wave 11: change a computed property's settings (and/or name). The server
   *  re-validates, including the circular-reference check, and says why in `detail`. */
  const updateConfig = async (id, config, name) => {
    const res = await fetch(`${url}/${id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, ...(name ? { name } : {}) }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail || `${res.status}`)
    }
    await mutate()
  }
  const remove = async (id) => {
    const res = await fetch(`${url}/${id}`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail || `${res.status}`)
    }
    await mutate()
  }

  return {
    propertyDefs, isLoading, error, refresh: () => mutate(),
    create, rename, updateOptions, updateConfig, remove,
  }
}
